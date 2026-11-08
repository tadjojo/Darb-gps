import { createHash } from 'node:crypto';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { DeviceGatewayService } from '../../src/device-gateway/device-gateway.service';
import { Nmea0183Adapter } from '../../src/device-gateway/adapters/nmea0183.adapter';
import { Gt06Adapter } from '../../src/device-gateway/adapters/gt06.adapter';
import { JsonTrackerAdapter } from '../../src/device-gateway/adapters/json.adapter';

const secret = 'tracker-secret-value-with-sufficient-length-123456';
const fix = {
  latitude: 31.9539, longitude: 35.9106, speedKmh: 32, heading: 90,
  accuracyMeters: 12, recordedAt: new Date(), batteryPercent: 82,
  signalStrengthDbm: -79, networkType: 'LTE',
};

function makeHarness(inserted = true) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT id, vehicle_id FROM tracking_devices'))
        return { rows: [{ id: 'device-1', vehicle_id: 'vehicle-1' }], rowCount: 1 };
      if (sql.includes('INSERT INTO locations'))
        return { rows: inserted ? [{ id: 'location-1', received_at: new Date() }] : [], rowCount: inserted ? 1 : 0 };
      if (sql.includes('INSERT INTO vehicle_latest_locations')) return { rows: [{ vehicle_id: 'vehicle-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn().mockResolvedValue(client) };
  const nmea = { parse: jest.fn().mockReturnValue(fix) } as unknown as Nmea0183Adapter;
  const gt06 = { parse: jest.fn().mockReturnValue(fix) } as unknown as Gt06Adapter;
  const json = { parse: jest.fn().mockReturnValue(fix) } as unknown as JsonTrackerAdapter;
  return { service: new DeviceGatewayService(pool as any, nmea, gt06, json), pool, client, calls };
}

describe('Device gateway ingestion', () => {
  it('requires a bearer credential and bounds payload size before database access', async () => {
    const h = makeHarness();
    await expect(h.service.ingest(undefined, 'json', '{"latitude":1}')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(h.service.ingest(`Bearer ${secret}`, 'json', 'x'.repeat(8193))).rejects.toBeInstanceOf(BadRequestException);
    expect(h.pool.connect).not.toHaveBeenCalled();
  });

  it('hashes the supplied credential, persists normalized fix and telemetry transactionally', async () => {
    const h = makeHarness();
    const result = await h.service.ingest(`Bearer ${secret}`, 'json', '{"latitude":31.9,"longitude":35.9,"recordedAt":"2026-11-06T10:00:00Z"}');
    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(h.calls[1].values?.[0]).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(h.calls.some(call => call.sql.includes('INSERT INTO event_outbox'))).toBe(true);
    expect(h.calls.some(call => call.sql.includes('battery_percent=COALESCE'))).toBe(true);
    expect(h.client.query).toHaveBeenCalledWith('COMMIT');
    expect(h.client.release).toHaveBeenCalled();
  });

  it('acknowledges replayed payloads without publishing a second location event', async () => {
    const h = makeHarness(false);
    const result = await h.service.ingest(`Bearer ${secret}`, 'json', '{"latitude":31.9,"longitude":35.9,"recordedAt":"2026-11-06T10:00:00Z"}');
    expect(result).toMatchObject({ accepted: true, duplicate: true, deviceId: 'device-1' });
    expect(h.calls.some(call => call.sql.includes('INSERT INTO event_outbox'))).toBe(false);
    expect(h.client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects a revoked or unknown tracker credential and rolls back', async () => {
    const h = makeHarness();
    h.client.query.mockImplementation(async (sql: string) => sql.includes('SELECT id, vehicle_id FROM tracking_devices')
      ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 });
    await expect(h.service.ingest(`Bearer ${secret}`, 'json', '{"latitude":31.9,"longitude":35.9,"recordedAt":"2026-11-06T10:00:00Z"}'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(h.client.release).toHaveBeenCalled();
  });
});
