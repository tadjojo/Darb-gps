const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { NotFoundException } = require('@nestjs/common');
const { TrackingService } = require('../dist/tracking/tracking.service');

const user = { sub: 'owner-user-1' };
const deviceId = '00000000-0000-4000-8000-000000000001';

test('GPS credential rotation stores only a hash and preserves device heartbeat', async () => {
  const query = async () => ({
    rowCount: 1,
    rows: [{ id: deviceId, vehicle_id: 'vehicle-1', protocol: 'gt06' }],
  });
  const service = new TrackingService({ query }, {}, {});
  const result = await service.rotateGpsTrackerCredential(user, deviceId);

  assert.equal(result.deviceId, deviceId);
  assert.equal(result.protocol, 'gt06');
  assert.match(result.credential, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.credentialFormat, 'Authorization: Bearer <credential>');
  assert.match(result.warning, /Previous credential is invalid immediately/);

  const hash = createHash('sha256').update(result.credential).digest('hex');
  assert.notEqual(hash, result.credential);
  assert.equal(hash.length, 64);

  const sql = query.toString();
  assert.ok(sql);
});

test('GPS credential rotation updates only active devices and requires owner or manager membership', async () => {
  let capturedSql = '';
  let capturedValues;
  const pool = {
    query: async (sql, values) => {
      capturedSql = sql;
      capturedValues = values;
      return { rowCount: 1, rows: [{ id: deviceId, vehicle_id: 'vehicle-1', protocol: 'json' }] };
    },
  };
  const service = new TrackingService(pool, {}, {});
  const result = await service.rotateGpsTrackerCredential(user, deviceId);

  assert.match(capturedSql, /UPDATE private\.darb_tracking_devices/);
  assert.match(capturedSql, /d\.status = 'active'/);
  assert.match(capturedSql, /vm\.status = 'active'/);
  assert.match(capturedSql, /vm\.role IN \('owner','manager'\)/);
  assert.match(capturedSql, /SET credential_hash = \$3/);
  assert.doesNotMatch(capturedSql, /last_seen_at\s*=/);
  assert.deepEqual(capturedValues.slice(0, 2), [deviceId, user.sub]);
  assert.equal(capturedValues[2], createHash('sha256').update(result.credential).digest('hex'));
  assert.notEqual(capturedValues[2], result.credential);
});

test('GPS credential rotation hides missing, revoked, and unauthorized devices behind 404', async () => {
  const pool = { query: async () => ({ rowCount: 0, rows: [] }) };
  const service = new TrackingService(pool, {}, {});
  await assert.rejects(
    service.rotateGpsTrackerCredential(user, deviceId),
    (error) => error instanceof NotFoundException && error.getStatus() === 404,
  );
});
