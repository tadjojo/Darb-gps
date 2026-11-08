import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeviceRegistryService } from '../../src/device-registry/device-registry.service';

const user = { sub: 'user-1' } as any;

describe('DeviceRegistryService', () => {
  it('maps metadata DTO fields to safe snake_case SQL columns', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'device-1', model_name: 'X1' }] });
    const service = new DeviceRegistryService({ query } as any);
    await service.updateMetadata(user, 'device-1', {
      modelName: 'X1', serialNumber: 'SER-1', firmwareVersion: '2.4',
      batteryPercent: 87, signalStrengthDbm: -76, networkType: 'LTE',
    });
    const updateSql = query.mock.calls[1][0] as string;
    expect(updateSql).toContain('model_name=$3');
    expect(updateSql).toContain('serial_number=$4');
    expect(updateSql).toContain('firmware_version=$5');
    expect(updateSql).toContain('battery_percent=$6');
    expect(updateSql).toContain('signal_strength_dbm=$7');
    expect(updateSql).toContain('network_type=$8');
    expect(updateSql).not.toMatch(/modelName|serialNumber|firmwareVersion|batteryPercent|signalStrengthDbm|networkType/);
    expect(query.mock.calls[1][1]).toEqual(['device-1', 'user-1', 'X1', 'SER-1', '2.4', 87, -76, 'LTE']);
  });

  it('rejects an empty metadata update before issuing SQL update', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const service = new DeviceRegistryService({ query } as any);
    await expect(service.updateMetadata(user, 'device-1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not disclose device identity fields in the vehicle listing query', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'device-1', connectionStatus: 'online' }] });
    const service = new DeviceRegistryService({ query } as any);
    await service.listForVehicle(user, 'vehicle-1');
    const listSql = query.mock.calls[1][0] as string;
    expect(listSql).not.toMatch(/\bimei\b|serial_number/i);
  });

  it('hides vehicles the user is not a member of', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const service = new DeviceRegistryService({ query } as any);
    await expect(service.listForVehicle(user, 'vehicle-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
