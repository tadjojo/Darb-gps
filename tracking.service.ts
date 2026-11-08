import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { AuthenticatedUser } from '../auth/auth.types';
import { MobileLocationDto } from './dto/mobile-location.dto';

@Injectable()
export class TrackingService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async assertVehicleAccess(userId: string, vehicleId: string, roles: string[]) {
    const result = await this.pool.query(
      `SELECT v.id, v.organization_id, v.status, vm.role
         FROM vehicles v
         JOIN vehicle_members vm ON vm.vehicle_id = v.id
        WHERE v.id = $1 AND vm.user_id = $2 AND vm.status = 'active'`,
      [vehicleId, userId],
    );
    const row = result.rows[0];
    if (!row || row.status !== 'active') throw new NotFoundException('Vehicle not found');
    if (!roles.includes(row.role)) throw new ForbiddenException('Insufficient vehicle permissions');
    return row;
  }

  async enrollMobileDevice(user: AuthenticatedUser, vehicleId: string) {
    await this.assertVehicleAccess(user.sub, vehicleId, ['owner', 'manager', 'driver']);
    // Mobile requests authenticate with the user's JWT. A random hash satisfies
    // the device credential column without creating an unused plaintext secret.
    const credentialHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const result = await this.pool.query(
      `INSERT INTO tracking_devices (vehicle_id, enrolled_by, device_type, credential_hash, status, enrolled_at)
       VALUES ($1, $2, 'mobile', $3, 'active', now()) RETURNING id, vehicle_id, status, enrolled_at`,
      [vehicleId, user.sub, credentialHash],
    );
    return { device: result.rows[0], authentication: 'user_jwt', note: 'Independent GPS tracker credentials are provisioned through the device gateway, not this mobile endpoint.' };
  }

  async enrollGpsTracker(user: AuthenticatedUser, vehicleId: string, label?: string) {
    await this.assertVehicleAccess(user.sub, vehicleId, ['owner', 'manager']);
    const secret = randomBytes(32).toString('base64url');
    const credentialHash = createHash('sha256').update(secret).digest('hex');
    const result = await this.pool.query(
      `INSERT INTO tracking_devices (vehicle_id, enrolled_by, device_type, credential_hash, status, enrolled_at, device_label)
       VALUES ($1, $2, 'gps_tracker', $3, 'active', now(), $4)
       RETURNING id, vehicle_id, status, enrolled_at, device_label`,
      [vehicleId, user.sub, credentialHash, label?.trim() || null],
    );
    // The raw credential is returned exactly once. Store it securely on the tracker.
    return { device: result.rows[0], credential: secret, credentialFormat: 'Bearer token' };
  }

  async revokeDevice(user: AuthenticatedUser, deviceId: string) {
    const result = await this.pool.query(
      `UPDATE tracking_devices d SET status = 'revoked'
        WHERE d.id = $1 AND EXISTS (
          SELECT 1 FROM vehicle_members vm
           WHERE vm.vehicle_id = d.vehicle_id AND vm.user_id = $2
             AND vm.status = 'active' AND vm.role IN ('owner','manager')
        ) RETURNING d.id`,
      [deviceId, user.sub],
    );
    if (!result.rowCount) throw new NotFoundException('Device not found or permission denied');
    return { revoked: true, deviceId };
  }

  async ingestMobileLocation(user: AuthenticatedUser, dto: MobileLocationDto) {
    const now = Date.now();
    const recorded = new Date(dto.recordedAt).getTime();
    if (!Number.isFinite(recorded) || recorded > now + 5 * 60_000 || recorded < now - 7 * 24 * 60 * 60_000) {
      throw new BadRequestException('GPS timestamp is outside the accepted window');
    }
    if (dto.accuracyMeters > 250) throw new BadRequestException('GPS accuracy is too low');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const access = await client.query(
        `SELECT v.id, v.status
           FROM vehicles v
           JOIN vehicle_members vm ON vm.vehicle_id = v.id
          WHERE v.id = $1 AND vm.user_id = $2 AND vm.status = 'active'
            AND vm.role IN ('owner','manager','driver')
          FOR SHARE OF v, vm`,
        [dto.vehicleId, user.sub],
      );
      if (!access.rows[0] || access.rows[0].status !== 'active') throw new NotFoundException('Vehicle not found');

      const device = await client.query(
        `SELECT id FROM tracking_devices
          WHERE id = $1 AND vehicle_id = $2 AND enrolled_by = $3
            AND device_type = 'mobile' AND status = 'active'
          FOR SHARE`,
        [dto.deviceId, dto.vehicleId, user.sub],
      );
      if (!device.rows[0]) throw new ForbiddenException('Device is not active or not assigned to this user and vehicle');

      const inserted = await client.query(
        `INSERT INTO locations
          (device_id, vehicle_id, event_id, position, speed_kmh, heading, accuracy_m, recorded_at, source)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8, $9, 'mobile')
         ON CONFLICT (device_id, event_id) DO NOTHING
         RETURNING id, received_at`,
        [dto.deviceId, dto.vehicleId, dto.eventId, dto.longitude, dto.latitude,
          dto.speedKmh ?? null, dto.heading ?? null, dto.accuracyMeters, dto.recordedAt],
      );
      if (!inserted.rowCount) {
        await client.query('COMMIT');
        return { accepted: true, duplicate: true, eventId: dto.eventId };
      }
      const location = inserted.rows[0];
      const latest = await client.query(
        `INSERT INTO vehicle_latest_locations (vehicle_id, location_id, recorded_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (vehicle_id) DO UPDATE
           SET location_id = EXCLUDED.location_id, recorded_at = EXCLUDED.recorded_at, updated_at = now()
         WHERE vehicle_latest_locations.recorded_at < EXCLUDED.recorded_at
         RETURNING vehicle_id`,
        [dto.vehicleId, location.id, dto.recordedAt],
      );
      await client.query(
        `UPDATE tracking_devices SET last_seen_at = now() WHERE id = $1`, [dto.deviceId],
      );
      // Historical late arrivals are retained, but cannot move a live map marker backwards.
      if (latest.rowCount) {
        await client.query(
          `INSERT INTO event_outbox (event_type, aggregate_id, payload)
           VALUES ('vehicle.location.updated', $1, $2::jsonb)`,
          [dto.vehicleId, JSON.stringify({ vehicleId: dto.vehicleId, deviceId: dto.deviceId,
            eventId: dto.eventId, locationId: location.id, latitude: dto.latitude,
            longitude: dto.longitude, speedKmh: dto.speedKmh ?? null,
            heading: dto.heading ?? null, accuracyMeters: dto.accuracyMeters,
            recordedAt: dto.recordedAt, receivedAt: location.received_at })],
        );
      }
      await client.query('COMMIT');
      return { accepted: true, duplicate: false, eventId: dto.eventId,
        locationId: location.id, becameLatest: Boolean(latest.rowCount) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }


  async getTrips(user: AuthenticatedUser, vehicleId: string, from: string, to: string, limit = 50) {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      throw new BadRequestException('Invalid trip date range');
    }
    if (toMs - fromMs > 31 * 24 * 60 * 60_000) {
      throw new BadRequestException('Trip history range cannot exceed 31 days');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('Trip limit must be between 1 and 100');
    }
    await this.assertVehicleAccess(user.sub, vehicleId, ['owner', 'manager', 'driver', 'viewer']);
    const result = await this.pool.query(
      `WITH windowed AS (
         SELECT l.id, l.device_id, l.recorded_at, l.position, l.speed_kmh,
                LAG(l.recorded_at) OVER (PARTITION BY l.device_id ORDER BY l.recorded_at, l.id) AS previous_at
           FROM locations l
          WHERE l.vehicle_id = $1
            AND l.recorded_at >= $2::timestamptz - interval '20 minutes'
            AND l.recorded_at <= $3::timestamptz
       ), marked AS (
         SELECT *, CASE WHEN previous_at IS NULL OR recorded_at - previous_at > interval '20 minutes'
                        THEN 1 ELSE 0 END AS new_trip
           FROM windowed
       ), grouped AS (
         SELECT *, SUM(new_trip) OVER (PARTITION BY device_id ORDER BY recorded_at, id) AS trip_group
           FROM marked
       ), paths AS (
         SELECT device_id, trip_group, MIN(recorded_at) AS start_at, MAX(recorded_at) AS end_at,
                COUNT(*)::int AS points_count,
                ST_MakeLine(position::geometry ORDER BY recorded_at, id) AS path,
                AVG(speed_kmh) FILTER (WHERE speed_kmh IS NOT NULL) AS average_speed_kmh,
                MAX(speed_kmh) AS max_speed_kmh
           FROM grouped
          GROUP BY device_id, trip_group
         HAVING COUNT(*) >= 2 AND MAX(recorded_at) >= $2::timestamptz
       )
       SELECT device_id, start_at, end_at, points_count,
              ST_Length(path::geography) AS distance_meters,
              average_speed_kmh, max_speed_kmh,
              ST_Y(ST_StartPoint(path)) AS start_latitude,
              ST_X(ST_StartPoint(path)) AS start_longitude,
              ST_Y(ST_EndPoint(path)) AS end_latitude,
              ST_X(ST_EndPoint(path)) AS end_longitude
         FROM paths ORDER BY start_at DESC LIMIT $4`,
      [vehicleId, from, to, limit],
    );
    return { data: result.rows, segmentation: { inactivityMinutes: 20, source: 'derived_from_location_gaps' } };
  }

  async getTripRoute(user: AuthenticatedUser, vehicleId: string, deviceId: string, from: string, to: string) {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      throw new BadRequestException('Invalid trip route date range');
    }
    if (toMs - fromMs > 31 * 24 * 60 * 60_000) {
      throw new BadRequestException('Trip route range cannot exceed 31 days');
    }
    await this.assertVehicleAccess(user.sub, vehicleId, ['owner', 'manager', 'driver', 'viewer']);
    const result = await this.pool.query(
      `SELECT ST_Y(position::geometry) AS latitude,
              ST_X(position::geometry) AS longitude,
              recorded_at, speed_kmh, accuracy_m
         FROM locations
        WHERE vehicle_id = $1 AND device_id = $2
          AND recorded_at >= $3::timestamptz AND recorded_at <= $4::timestamptz
        ORDER BY recorded_at ASC, id ASC
        LIMIT 5001`,
      [vehicleId, deviceId, from, to],
    );
    if (result.rows.length > 5000) {
      throw new BadRequestException('Trip route contains too many points; narrow the date range');
    }
    return { data: result.rows, pointCount: result.rows.length, deviceId,
      range: { from, to }, source: 'recorded_gps_points' };
  }

  async getStops(user: AuthenticatedUser, vehicleId: string, from: string, to: string, limit = 200) {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      throw new BadRequestException('Invalid stop history date range');
    }
    if (toMs - fromMs > 31 * 24 * 60 * 60_000) {
      throw new BadRequestException('Stop history range cannot exceed 31 days');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException('Stop limit must be between 1 and 500');
    }
    await this.assertVehicleAccess(user.sub, vehicleId, ['owner', 'manager', 'driver', 'viewer']);
    const result = await this.pool.query(
      `WITH ordered AS (
         SELECT l.id, l.device_id, l.position, l.recorded_at, l.speed_kmh,
                LAG(l.position) OVER (PARTITION BY l.device_id ORDER BY l.recorded_at, l.id) AS previous_position,
                LAG(l.recorded_at) OVER (PARTITION BY l.device_id ORDER BY l.recorded_at, l.id) AS previous_at,
                LAG(l.speed_kmh) OVER (PARTITION BY l.device_id ORDER BY l.recorded_at, l.id) AS previous_speed
           FROM locations l
          WHERE l.vehicle_id = $1
            AND l.recorded_at >= $2::timestamptz - interval '10 minutes'
            AND l.recorded_at <= $3::timestamptz
       ), candidates AS (
         SELECT *, (speed_kmh IS NOT NULL AND speed_kmh <= 3) AS stationary
           FROM ordered
       ), marked AS (
         SELECT *, CASE
           WHEN NOT stationary THEN 0
           WHEN previous_at IS NULL OR previous_at < $2::timestamptz
             OR previous_at < recorded_at - interval '10 minutes'
             OR previous_speed IS NULL OR previous_speed > 3
             OR ST_Distance(position, previous_position) > 100
           THEN 1 ELSE 0 END AS new_stop
           FROM candidates
       ), grouped AS (
         SELECT *, SUM(new_stop) OVER (PARTITION BY device_id ORDER BY recorded_at, id) AS stop_group
           FROM marked
          WHERE stationary
       ), summaries AS (
         SELECT device_id, stop_group, MIN(recorded_at) AS start_at, MAX(recorded_at) AS end_at,
                COUNT(*)::int AS points_count,
                ST_Centroid(ST_Collect(position::geometry)) AS center,
                MAX(speed_kmh) AS max_speed_kmh
           FROM grouped
          GROUP BY device_id, stop_group
         HAVING COUNT(*) >= 2 AND MAX(recorded_at) - MIN(recorded_at) >= interval '5 minutes'
       )
       SELECT device_id, start_at, end_at,
              EXTRACT(EPOCH FROM (end_at - start_at))::int AS duration_seconds,
              points_count, ST_Y(center) AS latitude, ST_X(center) AS longitude, max_speed_kmh
         FROM summaries
        WHERE end_at >= $2::timestamptz AND start_at <= $3::timestamptz
        ORDER BY start_at DESC LIMIT $4`,
      [vehicleId, from, to, limit],
    );
    return { data: result.rows, detection: { maxSpeedKmh: 3, maxGapMinutes: 10,
      maxConsecutiveDistanceMeters: 100, minimumDwellMinutes: 5,
      source: 'derived_from_gps_points' } };
  }

  async getLatestLocation(user: AuthenticatedUser, vehicleId: string) {
    await this.assertVehicleAccess(user.sub, vehicleId, ['owner', 'manager', 'driver', 'viewer']);
    const result = await this.pool.query(
      `SELECT l.id, l.vehicle_id, l.device_id, l.event_id,
              ST_Y(l.position::geometry) AS latitude,
              ST_X(l.position::geometry) AS longitude,
              l.speed_kmh, l.heading, l.accuracy_m, l.recorded_at, l.received_at
         FROM vehicle_latest_locations vl JOIN locations l ON l.id = vl.location_id
        WHERE vl.vehicle_id = $1`, [vehicleId],
    );
    return result.rows[0] ?? null;
  }
}
