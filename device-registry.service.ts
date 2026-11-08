import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { AuthenticatedUser } from '../auth/auth.types';
import { UpdateDeviceMetadataDto } from './dto/update-device-metadata.dto';

@Injectable()
export class DeviceRegistryService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async listForVehicle(user: AuthenticatedUser, vehicleId: string) {
    const access = await this.pool.query(
      `SELECT 1 FROM vehicle_members WHERE vehicle_id=$1 AND user_id=$2 AND status='active'`,
      [vehicleId, user.sub],
    );
    if (!access.rowCount) throw new NotFoundException('Vehicle not found');
    const result = await this.pool.query(
      `SELECT id, vehicle_id, device_type, device_label, status, manufacturer, model_name,
              firmware_version, hardware_version, last_protocol,
              last_seen_at, battery_percent, signal_strength_dbm, network_type,
              telemetry_updated_at, enrolled_at, created_at
         FROM tracking_devices WHERE vehicle_id=$1 ORDER BY created_at DESC`, [vehicleId],
    );
    return result.rows.map((row: any) => ({ ...row,
      connectionStatus: !row.last_seen_at ? 'never_connected' :
        (Date.now() - new Date(row.last_seen_at).getTime() <= 120_000 ? 'online' : 'offline'),
    }));
  }

  async updateMetadata(user: AuthenticatedUser, deviceId: string, dto: UpdateDeviceMetadataDto) {
    // Explicit allowlist maps public DTO camelCase names to PostgreSQL snake_case columns.
    // Never interpolate a client-supplied column name into SQL.
    const fields: ReadonlyArray<[string, keyof UpdateDeviceMetadataDto]> = [
      ['manufacturer', 'manufacturer'], ['model_name', 'modelName'], ['imei', 'imei'],
      ['serial_number', 'serialNumber'], ['firmware_version', 'firmwareVersion'],
      ['hardware_version', 'hardwareVersion'], ['battery_percent', 'batteryPercent'],
      ['signal_strength_dbm', 'signalStrengthDbm'], ['network_type', 'networkType'],
    ];
    const entries = fields.filter(([, key]) => dto[key] !== undefined);
    if (!entries.length) throw new BadRequestException('At least one metadata field is required');
    const values: unknown[] = [deviceId, user.sub];
    const assignments = entries.map(([column, key]) => {
      values.push(dto[key]); return `${column}=$${values.length}`;
    });
    assignments.push('telemetry_updated_at=now()');
    const result = await this.pool.query(
      `UPDATE tracking_devices d SET ${assignments.join(', ')}
        WHERE d.id=$1 AND EXISTS (
          SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=d.vehicle_id
            AND vm.user_id=$2 AND vm.status='active' AND vm.role IN ('owner','manager')
        ) RETURNING id, vehicle_id, manufacturer, model_name, imei, serial_number,
                    firmware_version, hardware_version, battery_percent, signal_strength_dbm,
                    network_type, telemetry_updated_at`, values,
    );
    if (!result.rowCount) throw new NotFoundException('Device not found or permission denied');
    return result.rows[0];
  }
}
