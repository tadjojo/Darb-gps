const test = require('node:test');
const assert = require('node:assert/strict');
const { TrackingService } = require('../dist/tracking/tracking.service');

test('device listing returns a compatible row shape for mobile and GPS devices', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (calls.length === 1) return { rows: [{ id: 'vehicle-1', vehicle_status: 'active', role: 'owner' }] };
      return { rows: [
        { id: 'mobile-1', device_type: 'mobile', label: null, protocol: null, imei: null, model: null, timezone_offset_minutes: null },
        { id: 'gps-1', device_type: 'gps_tracker', label: 'Tracker', protocol: 'gt06', imei: '123456789012345', model: 'GT06', timezone_offset_minutes: 180 },
      ] };
    },
  };
  const service = new TrackingService(pool, {}, {});
  const rows = await service.listDevices({ sub: 'user-1' }, 'vehicle-1');

  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /UNION ALL/);
  const mobileSelect = calls[1].sql.split(/UNION ALL/i)[0];
  const trackerSelect = calls[1].sql.split(/UNION ALL/i)[1];
  const mobileColumns = mobileSelect.match(/SELECT([\s\S]*?)FROM/i)[1].split(',').length;
  const trackerColumns = trackerSelect.match(/SELECT([\s\S]*?)FROM/i)[1].split(',').length;
  assert.equal(mobileColumns, 11);
  assert.equal(trackerColumns, 11);
  assert.match(mobileSelect, /NULL::text AS label/);
  assert.match(mobileSelect, /NULL::integer AS timezone_offset_minutes/);
  assert.equal(rows[0].device_type, 'mobile');
  assert.equal(rows[1].device_type, 'gps_tracker');
  assert.deepEqual(calls[1].values, ['vehicle-1']);
});

test('device listing checks vehicle membership before querying device tables', async () => {
  const calls = [];
  const pool = { query: async (sql) => { calls.push(sql); return { rows: [], rowCount: 0 }; } };
  const service = new TrackingService(pool, {}, {});
  await assert.rejects(service.listDevices({ sub: 'outsider' }, 'vehicle-1'));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /vehicle_members/);
});
