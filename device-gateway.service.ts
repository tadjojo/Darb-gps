import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { TrackerProtocol, TrackerProtocolAdapter } from './protocol.types';
import { Nmea0183Adapter } from './adapters/nmea0183.adapter';
import { Gt06Adapter } from './adapters/gt06.adapter';
import { JsonTrackerAdapter } from './adapters/json.adapter';

@Injectable()
export class DeviceGatewayService {
  private readonly adapters: Map<TrackerProtocol, TrackerProtocolAdapter>;
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    nmea: Nmea0183Adapter,
    gt06: Gt06Adapter,
    json: JsonTrackerAdapter,
  ) {
    this.adapters = new Map<TrackerProtocol, TrackerProtocolAdapter>([['nmea0183', nmea], ['gt06', gt06], ['json', json]]);
  }

  async ingest(authorization: string | undefined, protocol: TrackerProtocol, payload: string) {
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new UnauthorizedException('Tracker bearer credential required');
    if (typeof payload !== 'string' || payload.length < 8 || payload.length > 8192) throw new BadRequestException('Payload size is invalid');
    const adapter = this.adapters.get(protocol);
    if (!adapter) throw new BadRequestException('Unsupported tracker protocol');
    const secret = authorization.replace(/^Bearer\s+/i, '').trim();
    const credentialHash = createHash('sha256').update(secret).digest('hex');
    const fix = adapter.parse(payload);
    const now = Date.now(); const recorded = fix.recordedAt.getTime();
    if (recorded > now + 5 * 60_000 || recorded < now - 7 * 24 * 60 * 60_000) throw new BadRequestException('Tracker timestamp is outside the accepted window');
    const stableDigest = createHash('sha256').update(`${protocol}\n${payload}`).digest();
    stableDigest[6] = (stableDigest[6] & 0x0f) | 0x50;
    stableDigest[8] = (stableDigest[8] & 0x3f) | 0x80;
    const eventId = [stableDigest.subarray(0, 4).toString('hex'), stableDigest.subarray(4, 6).toString('hex'), stableDigest.subarray(6, 8).toString('hex'), stableDigest.subarray(8, 10).toString('hex'), stableDigest.subarray(10, 16).toString('hex')].join('-');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the active credential row until the location transaction commits.
      // A concurrent revoke therefore cannot race past this authorization check.
      const deviceResult = await client.query(
        `SELECT id, vehicle_id FROM tracking_devices
          WHERE credential_hash = $1 AND device_type = 'gps_tracker' AND status = 'active'
          FOR SHARE`,
        [credentialHash],
      );
      const device = deviceResult.rows[0] as { id: string; vehicle_id: string } | undefined;
      if (!device) throw new UnauthorizedException('Tracker credential is invalid or revoked');
      const inserted = await client.query(
        `INSERT INTO locations (device_id, vehicle_id, event_id, position, speed_kmh, heading, accuracy_m, recorded_at, source)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5),4326)::geography, $6, $7, $8, $9, $10)
         ON CONFLICT (device_id, event_id) DO NOTHING RETURNING id, received_at`,
        [device.id, device.vehicle_id, eventId, fix.longitude, fix.latitude, fix.speedKmh, fix.heading, fix.accuracyMeters, fix.recordedAt.toISOString(), protocol],
      );
      await client.query(
        `UPDATE tracking_devices SET last_seen_at=now(), last_protocol=$2,
           battery_percent=COALESCE($3,battery_percent),
           signal_strength_dbm=COALESCE($4,signal_strength_dbm),
           network_type=COALESCE($5,network_type),
           telemetry_updated_at=CASE WHEN $3::smallint IS NOT NULL OR $4::smallint IS NOT NULL OR $5::text IS NOT NULL THEN now() ELSE telemetry_updated_at END
         WHERE id=$1`,
        [device.id, protocol, fix.batteryPercent ?? null, fix.signalStrengthDbm ?? null, fix.networkType ?? null],
      );
      if (!inserted.rowCount) {
        await client.query('COMMIT');
        return { accepted: true, duplicate: true, deviceId: device.id, eventId };
      }
      const location = inserted.rows[0];
      const latest = await client.query(
        `INSERT INTO vehicle_latest_locations (vehicle_id, location_id, recorded_at) VALUES ($1,$2,$3)
         ON CONFLICT (vehicle_id) DO UPDATE SET location_id=EXCLUDED.location_id, recorded_at=EXCLUDED.recorded_at, updated_at=now()
         WHERE vehicle_latest_locations.recorded_at < EXCLUDED.recorded_at RETURNING vehicle_id`,
        [device.vehicle_id, location.id, fix.recordedAt.toISOString()],
      );
      if (latest.rowCount) await client.query(
        `INSERT INTO event_outbox(event_type, aggregate_id, payload) VALUES ('vehicle.location.updated',$1,$2::jsonb)`,
        [device.vehicle_id, JSON.stringify({ vehicleId: device.vehicle_id, deviceId: device.id, eventId,
          locationId: location.id, latitude: fix.latitude, longitude: fix.longitude,
          speedKmh: fix.speedKmh, heading: fix.heading, accuracyMeters: fix.accuracyMeters,
          recordedAt: fix.recordedAt.toISOString(), receivedAt: location.received_at, source: protocol })],
      );
      await client.query('COMMIT');
      return { accepted: true, duplicate: false, deviceId: device.id, eventId, locationId: location.id, becameLatest: Boolean(latest.rowCount) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
