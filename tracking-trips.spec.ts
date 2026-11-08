import { BadRequestException } from '@nestjs/common';
import { TrackingService } from '../../src/tracking/tracking.service';

const user = { sub: 'user-1' } as any;

describe('TrackingService trip history', () => {
  const from = '2026-11-01T00:00:00.000Z';
  const to = '2026-11-07T00:00:00.000Z';

  it('checks vehicle membership and derives trips from location inactivity gaps', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'vehicle-1', status: 'active', role: 'viewer' }] })
      .mockResolvedValueOnce({ rows: [{ points_count: 4, distance_meters: 1250 }] });
    const service = new TrackingService({ query } as any);
    const result = await service.getTrips(user, 'vehicle-1', from, to, 25);
    expect(query).toHaveBeenCalledTimes(2);
    const sql = query.mock.calls[1][0] as string;
    expect(sql).toContain("interval '20 minutes'");
    expect(sql).toContain('PARTITION BY l.device_id');
    expect(sql).toContain('GROUP BY device_id, trip_group');
    expect(sql).toContain('ST_MakeLine');
    expect(sql).toContain('ST_Length(path::geography)');
    expect(query.mock.calls[1][1]).toEqual(['vehicle-1', from, to, 25]);
    expect(result.segmentation).toEqual({ inactivityMinutes: 20, source: 'derived_from_location_gaps' });
  });

  it('rejects invalid or reversed date ranges before database access', async () => {
    const query = jest.fn();
    const service = new TrackingService({ query } as any);
    await expect(service.getTrips(user, 'vehicle-1', to, from)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getTrips(user, 'vehicle-1', 'bad-date', to)).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('caps requested history to 31 days and result count to 100', async () => {
    const query = jest.fn();
    const service = new TrackingService({ query } as any);
    await expect(service.getTrips(user, 'vehicle-1', '2026-09-01T00:00:00Z', to)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getTrips(user, 'vehicle-1', from, to, 101)).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
});
