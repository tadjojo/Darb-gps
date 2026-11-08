import { BadRequestException } from '@nestjs/common';
import { TrackingService } from '../../src/tracking/tracking.service';

const user = { sub: 'user-1' } as any;
const from = '2026-11-01T00:00:00.000Z';
const to = '2026-11-02T00:00:00.000Z';

describe('TrackingService stop detection', () => {
  it('authorizes access and groups stationary points per GPS device', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'vehicle-1', status: 'active', role: 'viewer' }] })
      .mockResolvedValueOnce({ rows: [{ duration_seconds: 420, points_count: 8 }] });
    const service = new TrackingService({ query } as any);
    const result = await service.getStops(user, 'vehicle-1', from, to, 100);
    const sql = query.mock.calls[1][0] as string;
    expect(sql).toContain('PARTITION BY l.device_id');
    expect(sql).toContain('speed_kmh <= 3');
    expect(sql).toContain("interval '5 minutes'");
    expect(sql).toContain('ST_Distance(position, previous_position) > 100');
    expect(query.mock.calls[1][1]).toEqual(['vehicle-1', from, to, 100]);
    expect(result.detection.minimumDwellMinutes).toBe(5);
  });

  it('rejects invalid ranges and limits before database access', async () => {
    const query = jest.fn();
    const service = new TrackingService({ query } as any);
    await expect(service.getStops(user, 'vehicle-1', to, from)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getStops(user, 'vehicle-1', '2026-09-01T00:00:00Z', to)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getStops(user, 'vehicle-1', from, to, 501)).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
});
