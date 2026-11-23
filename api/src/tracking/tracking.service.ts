import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { AuthenticatedUser } from '../auth/auth.types';
import { IngestLocationDto } from './dto/ingest-location.dto';
import { TrackerLocationDto } from '../device-gateway/dto/tracker-location.dto';
import { TrackingGateway } from './tracking.gateway';

@Injectable()
export class TrackingService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly gateway: TrackingGateway) {}

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
    const device = await this.pool.query(
      `SELECT id, vehicle_id FROM private.darb_tracking_devices
        WHERE credential_hash = $1 AND status = 'active'`,
      [hash],
    );
    if (!device.rowCount) throw new UnauthorizedException('GPS tracker credential is invalid or revoked');
    const row = device.rows[0];
    const inserted = await this.pool.query(
      `INSERT INTO public.vehicle_locations (vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE EXISTS (SELECT 1 FROM public.vehicles WHERE id = $1 AND status = 'active')
       RETURNING id, vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, received_at`,
      [row.vehicle_id, dto.latitude, dto.longitude, dto.speedKmh ?? 0, dto.heading ?? null, dto.recordedAt],
    );
    if (!inserted.rowCount) throw new NotFoundException('Assigned vehicle is not active');
    await this.pool.query(
      `UPDATE private.darb_tracking_devices SET last_seen_at = now(), last_protocol = 'json' WHERE id = $1`,
      [row.id],
    );
    await this.publishIfLatest(inserted.rows[0]);
    return { accepted: true, location: inserted.rows[0] };
  }

  async ingest(user: AuthenticatedUser, dto: IngestLocationDto) {
    const recorded = Date.parse(dto.recordedAt);
    const now = Date.now();
    if (!Number.isFinite(recorded) || recorded > now + 5 * 60_000 || recorded < now - 7 * 24 * 60 * 60_000) {
      throw new BadRequestException('GPS timestamp is outside the accepted seven-day window');
    }
    await this.assertAccess(user.sub, dto.vehicleId, true);
    const result = await this.pool.query(
      `INSERT INTO vehicle_locations (vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, received_at`,
      [dto.vehicleId, dto.latitude, dto.longitude, dto.speedKmh ?? 0, dto.heading ?? null, dto.recordedAt],
    );
    await this.publishIfLatest(result.rows[0]);
    return { accepted: true, location: result.rows[0] };
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
