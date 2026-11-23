import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { AuthenticatedUser } from '../auth/auth.types';
import { IngestLocationDto } from './dto/ingest-location.dto';
import { TrackerLocationDto } from '../device-gateway/dto/tracker-location.dto';
import { TrackingGateway } from './tracking.gateway';
import { AlertsService } from '../alerts/alerts.service';

@Injectable()
export class TrackingService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly gateway: TrackingGateway, private readonly alerts: AlertsService) {}

  private async publishIfLatest(location: any) {
    const latest = await this.pool.query(
      'SELECT id FROM public.vehicle_locations WHERE vehicle_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1',
      [location.vehicle_id],
    );
    if (latest.rows[0] && String(latest.rows[0].id) === String(location.id)) {
      this.gateway.publishLocation({
        vehicleId: location.vehicle_id,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        speedKmh: Number(location.speed_kmh ?? 0),
        heading: location.heading === null ? null : Number(location.heading),
        recordedAt: new Date(location.recorded_at).toISOString(),
        locationId: location.id,
      });
    }
  }

  private async assertAccess(userId: string, vehicleId: string, write = false) {
    const result = await this.pool.query(
      `SELECT v.id, v.status AS vehicle_status, vm.role
         FROM vehicles v
         JOIN vehicle_members vm ON vm.vehicle_id = v.id
        WHERE v.id = $1 AND vm.user_id = $2 AND vm.status = 'active'`,
      [vehicleId, userId],
    );
    const row = result.rows[0];
    if (!row || row.vehicle_status !== 'active') throw new NotFoundException('Vehicle not found');
    if (write && !['owner', 'manager', 'driver'].includes(row.role)) {
      throw new ForbiddenException('Insufficient vehicle permissions');
    }
  }

  async enrollMobileDevice(user: AuthenticatedUser, vehicleId: string) {
    const access = await this.pool.query(
      `SELECT 1 FROM public.vehicles v JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
        WHERE v.id = $1 AND v.status = 'active' AND vm.user_id = $2
          AND vm.status = 'active' AND vm.role IN ('owner','manager','driver')`,
      [vehicleId, user.sub],
    );
    if (!access.rowCount) throw new NotFoundException('Vehicle not found or permission denied');
    const result = await this.pool.query(
      `INSERT INTO private.darb_mobile_devices (vehicle_id, user_id, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (vehicle_id, user_id) DO UPDATE SET status = 'active'
       RETURNING id, vehicle_id, status, enrolled_at`,
      [vehicleId, user.sub],
    );
    return { device: result.rows[0], authentication: 'user_jwt' };
  }

  async listDevices(user: AuthenticatedUser, vehicleId: string) {
    await this.assertAccess(user.sub, vehicleId);
    const result = await this.pool.query(
      `SELECT id, vehicle_id, 'mobile'::text AS device_type, status, enrolled_at AS created_at, last_seen_at
         FROM private.darb_mobile_devices WHERE vehicle_id = $1
       UNION ALL
       SELECT id, vehicle_id, 'gps_tracker'::text AS device_type, status, created_at, last_seen_at
         FROM private.darb_tracking_devices WHERE vehicle_id = $1
       ORDER BY created_at DESC`,
      [vehicleId],
    );
    return result.rows;
  }

  async enrollGpsTracker(user: AuthenticatedUser, vehicleId: string, label?: string) {
    const access = await this.pool.query(
      `SELECT 1 FROM vehicles v JOIN vehicle_members vm ON vm.vehicle_id = v.id
        WHERE v.id = $1 AND v.status = 'active' AND vm.user_id = $2
          AND vm.status = 'active' AND vm.role IN ('owner','manager')`,
      [vehicleId, user.sub],
    );
    if (!access.rowCount) throw new NotFoundException('Vehicle not found or permission denied');
    const secret = randomBytes(32).toString('base64url');
    const credentialHash = createHash('sha256').update(secret).digest('hex');
    const created = await this.pool.query(
      `INSERT INTO private.darb_tracking_devices (vehicle_id, created_by, label, credential_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, vehicle_id, label, status, created_at`,
      [vehicleId, user.sub, label?.trim() || null, credentialHash],
    );
    return { device: created.rows[0], credential: secret, credentialFormat: 'Authorization: Bearer <credential>', warning: 'Store this credential securely; it is shown only once.' };
  }

  async revokeGpsTracker(user: AuthenticatedUser, deviceId: string) {
    const result = await this.pool.query(
      `UPDATE private.darb_tracking_devices d SET status = 'revoked'
        WHERE d.id = $1 AND d.status = 'active'
          AND EXISTS (SELECT 1 FROM vehicle_members vm
            WHERE vm.vehicle_id = d.vehicle_id AND vm.user_id = $2
              AND vm.status = 'active' AND vm.role IN ('owner','manager'))
        RETURNING d.id`,
      [deviceId, user.sub],
    );
    if (!result.rowCount) throw new NotFoundException('Device not found or permission denied');
    return { revoked: true, deviceId };
  }

  async ingestGpsTracker(authorization: string | undefined, dto: TrackerLocationDto) {
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new UnauthorizedException('GPS tracker credential required');
    const secret = authorization.replace(/^Bearer\s+/i, '').trim();
    const hash = createHash('sha256').update(secret).digest('hex');
    const recorded = Date.parse(dto.recordedAt);
    const now = Date.now();
    if (!Number.isFinite(recorded) || recorded > now + 5 * 60_000 || recorded < now - 7 * 24 * 60 * 60_000) {
      throw new BadRequestException('GPS timestamp is outside the accepted seven-day window');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const device = await client.query(
        `SELECT id, vehicle_id FROM private.darb_tracking_devices
          WHERE credential_hash = $1 AND status = 'active'
          FOR SHARE`,
        [hash],
      );
      if (!device.rowCount) throw new UnauthorizedException('GPS tracker credential is invalid or revoked');
      const row = device.rows[0];
      const inserted = await client.query(
        `INSERT INTO public.vehicle_locations
          (vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, event_id, source)
         SELECT $1, $2, $3, $4, $5, $6, $7, 'gps_tracker'
          WHERE EXISTS (SELECT 1 FROM public.vehicles WHERE id = $1 AND status = 'active')
         ON CONFLICT (vehicle_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
         RETURNING id, vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, received_at`,
        [row.vehicle_id, dto.latitude, dto.longitude, dto.speedKmh ?? 0, dto.heading ?? null, dto.recordedAt, dto.eventId ?? null],
      );
      if (!inserted.rowCount) {
        await client.query('COMMIT');
        return { accepted: true, duplicate: true, eventId: dto.eventId };
      }
      await client.query(
        `UPDATE private.darb_tracking_devices
            SET last_seen_at = now(), last_protocol = 'json'
          WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
      await this.alerts.evaluateLocation(inserted.rows[0]).catch((error) => console.error('GPS tracker alert evaluation failed', error));
      await this.publishIfLatest(inserted.rows[0]);
      return { accepted: true, duplicate: false, location: inserted.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ingest(user: AuthenticatedUser, dto: IngestLocationDto) {
    const recorded = Date.parse(dto.recordedAt);
    const now = Date.now();
    if (!Number.isFinite(recorded) || recorded > now + 5 * 60_000 || recorded < now - 7 * 24 * 60 * 60_000) {
      throw new BadRequestException('GPS timestamp is outside the accepted seven-day window');
    }
    if (dto.accuracyMeters !== undefined && dto.accuracyMeters > 250) throw new BadRequestException('GPS accuracy is too low');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const access = await client.query(
        `SELECT v.id, v.status AS vehicle_status, vm.role
           FROM public.vehicles v
           JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
          WHERE v.id = $1 AND vm.user_id = $2 AND vm.status = 'active'
          FOR SHARE OF v, vm`,
        [dto.vehicleId, user.sub],
      );
      const membership = access.rows[0];
      if (!membership || membership.vehicle_status !== 'active') throw new NotFoundException('Vehicle not found');
      if (!['owner', 'manager', 'driver'].includes(membership.role)) throw new ForbiddenException('Insufficient vehicle permissions');
      if (dto.deviceId) {
        const device = await client.query(
          `SELECT id FROM private.darb_mobile_devices
            WHERE id = $1 AND vehicle_id = $2 AND user_id = $3 AND status = 'active'
            FOR SHARE`,
          [dto.deviceId, dto.vehicleId, user.sub],
        );
        if (!device.rowCount) throw new ForbiddenException('Mobile device is not enrolled for this user and vehicle');
      }
      const result = await client.query(
        `INSERT INTO public.vehicle_locations
          (vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, event_id, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'mobile')
         ON CONFLICT (vehicle_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
         RETURNING id, vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, received_at`,
        [dto.vehicleId, dto.latitude, dto.longitude, dto.speedKmh ?? 0, dto.heading ?? null, dto.recordedAt, dto.eventId ?? null],
      );
      if (!result.rowCount) {
        await client.query('COMMIT');
        return { accepted: true, duplicate: true, eventId: dto.eventId };
      }
      if (dto.deviceId) await client.query(
        'UPDATE private.darb_mobile_devices SET last_seen_at = now() WHERE id = $1',
        [dto.deviceId],
      );
      await client.query('COMMIT');
      await this.alerts.evaluateLocation(result.rows[0]).catch((error) => console.error('Mobile tracking alert evaluation failed', error));
      await this.publishIfLatest(result.rows[0]);
      return { accepted: true, duplicate: false, location: result.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async latest(user: AuthenticatedUser, vehicleId: string) {
    await this.assertAccess(user.sub, vehicleId);
    const result = await this.pool.query(
      `SELECT id, vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, received_at
         FROM vehicle_locations
        WHERE vehicle_id = $1
        ORDER BY recorded_at DESC, id DESC
        LIMIT 1`,
      [vehicleId],
    );
    if (!result.rowCount) return null;
    return result.rows[0];
  }

  async getTrips(user: AuthenticatedUser, vehicleId: string, from: string, to: string, limit = 50) {
    await this.assertAccess(user.sub, vehicleId);
    const start = Date.parse(from), end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 31 * 86400000) {
      throw new BadRequestException('Invalid trip date range; maximum range is 31 days');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Trip limit must be 1..100');
    const result = await this.pool.query(
      `SELECT id, latitude, longitude, speed_kmh, recorded_at
         FROM public.vehicle_locations WHERE vehicle_id = $1
          AND recorded_at >= $2 AND recorded_at <= $3
        ORDER BY recorded_at ASC LIMIT 10000`,
      [vehicleId, from, to],
    );
    const trips: any[] = [];
    let points: any[] = [];
    const distance = (a: any, b: any) => {
      const rad = (n: number) => n * Math.PI / 180;
      const dLat = rad(Number(b.latitude) - Number(a.latitude));
      const dLon = rad(Number(b.longitude) - Number(a.longitude));
      const x = Math.sin(dLat/2)**2 + Math.cos(rad(Number(a.latitude))) * Math.cos(rad(Number(b.latitude))) * Math.sin(dLon/2)**2;
      return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
    };
    const flush = () => {
      if (points.length < 2) { points = []; return; }
      let meters = 0;
      for (let i = 1; i < points.length; i++) meters += distance(points[i-1], points[i]);
      trips.push({
        id: String(points[0].id), device_id: 'all',
        start_at: points[0].recorded_at, end_at: points[points.length-1].recorded_at,
        distance_meters: Math.round(meters), points_count: points.length,
      });
      points = [];
    };
    for (const point of result.rows) {
      if (points.length && Date.parse(point.recorded_at) - Date.parse(points[points.length-1].recorded_at) > 30 * 60_000) flush();
      points.push(point);
    }
    flush();
    return trips.reverse().slice(0, limit);
  }

  async getTripRoute(user: AuthenticatedUser, vehicleId: string, from: string, to: string) {
    await this.assertAccess(user.sub, vehicleId);
    const start = Date.parse(from), end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 31 * 86400000) throw new BadRequestException('Invalid route date range');
    const result = await this.pool.query(
      `SELECT id, vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at
         FROM public.vehicle_locations WHERE vehicle_id = $1 AND recorded_at >= $2 AND recorded_at <= $3
        ORDER BY recorded_at ASC LIMIT 10000`,
      [vehicleId, from, to],
    );
    return result.rows;
  }

  async getStops(user: AuthenticatedUser, vehicleId: string, from: string, to: string, limit = 100) {
    await this.assertAccess(user.sub, vehicleId);
    const start = Date.parse(from), end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 31 * 86400000) throw new BadRequestException('Invalid stop date range');
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new BadRequestException('Stop limit must be 1..500');
    const result = await this.pool.query(
      `SELECT latitude, longitude, speed_kmh, recorded_at
         FROM public.vehicle_locations WHERE vehicle_id = $1 AND recorded_at >= $2 AND recorded_at <= $3
        ORDER BY recorded_at ASC LIMIT 10000`,
      [vehicleId, from, to],
    );
    const stops: any[] = [];
    let points: any[] = [];
    const flush = () => {
      if (points.length >= 2) {
        const duration = (Date.parse(points[points.length-1].recorded_at) - Date.parse(points[0].recorded_at)) / 1000;
        if (duration >= 300) stops.push({
          start_at: points[0].recorded_at, duration_seconds: Math.round(duration),
          points_count: points.length, latitude: Number(points[0].latitude), longitude: Number(points[0].longitude),
        });
      }
      points = [];
    };
    for (const point of result.rows) {
      const stopped = Number(point.speed_kmh ?? 0) <= 3;
      if (!stopped || (points.length && Date.parse(point.recorded_at) - Date.parse(points[points.length-1].recorded_at) > 10 * 60_000)) flush();
      if (stopped) points.push(point);
    }
    flush();
    return stops.reverse().slice(0, limit);
  }

  async history(user: AuthenticatedUser, vehicleId: string, from?: string, to?: string, limit = 500) {
    await this.assertAccess(user.sub, vehicleId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new BadRequestException('Limit must be between 1 and 2000');
    if (from && !Number.isFinite(Date.parse(from))) throw new BadRequestException('Invalid from timestamp');
    if (to && !Number.isFinite(Date.parse(to))) throw new BadRequestException('Invalid to timestamp');
    if (from && to && Date.parse(from) >= Date.parse(to)) throw new BadRequestException('from must be earlier than to');
    const result = await this.pool.query(
      `SELECT id, vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, received_at
         FROM vehicle_locations
        WHERE vehicle_id = $1
          AND ($2::timestamptz IS NULL OR recorded_at >= $2)
          AND ($3::timestamptz IS NULL OR recorded_at <= $3)
        ORDER BY recorded_at DESC, id DESC
        LIMIT $4`,
      [vehicleId, from ?? null, to ?? null, limit],
    );
    return result.rows;
  }
}
