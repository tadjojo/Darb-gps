import { BadRequestException } from '@nestjs/common';
import { TrackingService } from '../../src/tracking/tracking.service';

const user = { sub: 'user-1' } as any;
const from = '2026-11-01T10:00:00.000Z';
const to = '2026-11-01T11:00:00.000Z';

describe('TrackingService trip route', () => {
  it('authorizes vehicle access and returns ordered GPS points for the requested device only', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'vehicle-1', status: 'active', role: 'viewer' }] })
      .mockResolvedValueOnce({ rows: [{ latitude: 31.9, longitude: 35.9 }] });
    const service = new TrackingService({ query } as any);
    const result = await service.getTripRoute(user, 'vehicle-1', 'device-1', from, to);
    expect(query).toHaveBeenCalledTimes(2);
    const sql = query.mock.calls[1][0] as string;
    expect(sql).toContain('device_id = $2');
    expect(sql).toContain('ORDER BY recorded_at ASC, id ASC');
    expect(sql).toContain('LIMIT 5001');
    expect(query.mock.calls[1][1]).toEqual(['vehicle-1', 'device-1', from, to]);
    expect(result.pointCount).toBe(1);
    expect(result.source).toBe('recorded_gps_points');
  });

  it('rejects reversed or overlong ranges before querying the database', async () => {
    const query = jest.fn();
    const service = new TrackingService({ query } as any);
    await expect(service.getTripRoute(user, 'vehicle-1', 'device-1', to, from)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getTripRoute(user, 'vehicle-1', 'device-1', '2026-09-01T00:00:00Z', to)).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects routes exceeding the bounded point count', async () => {
    const rows = Array.from({ length: 5001 }, () => ({ latitude: 31.9, longitude: 35.9 }));
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'vehicle-1', status: 'active', role: 'driver' }] })
      .mockResolvedValueOnce({ rows });
    const service = new TrackingService({ query } as any);
    await expect(service.getTripRoute(user, 'vehicle-1', 'device-1', from, to)).rejects.toBeInstanceOf(BadRequestException);
  });
});
