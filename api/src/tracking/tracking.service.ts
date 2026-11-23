import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { AuthenticatedUser } from '../auth/auth.types';
import { IngestLocationDto } from './dto/ingest-location.dto';

@Injectable()
export class TrackingService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

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
