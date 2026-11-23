'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { requiredPorts, checkPort, runHealthcheck } = require('../healthcheck');

test('GT06 listener is always required and NMEA is required only when configured', () => {
  assert.deepEqual(requiredPorts({}), [5023]);
  assert.deepEqual(requiredPorts({ GT06_PORT: '6000', NMEA_PORT: '6001', NMEA_DEVICE_MAP_JSON: '{}' }), [6000]);
  assert.deepEqual(requiredPorts({ GT06_PORT: '6000', NMEA_PORT: '6001', NMEA_DEVICE_MAP_JSON: '{"192.0.2.5":{"bearerToken":"x"}}' }), [6000, 6001]);
});

test('invalid healthcheck port configuration is rejected', () => {
  assert.throws(() => requiredPorts({ GT06_PORT: '0' }), /GT06_PORT/);
  assert.throws(() => requiredPorts({ NMEA_DEVICE_MAP_JSON: '{bad' }), /valid JSON/);
  assert.throws(() => requiredPorts({ GT06_PORT: '5023', NMEA_PORT: '5023', NMEA_DEVICE_MAP_JSON: '{"192.0.2.5":{}}' }), /distinct/);
});

test('TCP probe detects a listening socket and a closed port', async () => {
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    assert.equal(await checkPort(port), true);
    assert.equal(await runHealthcheck({ GT06_PORT: String(port), NMEA_DEVICE_MAP_JSON: '{}' }), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.equal(await checkPort(port, '127.0.0.1', 300), false);
});

test('healthcheck fails when any configured listener is unavailable', async () => {
  const probed = [];
  const healthy = await runHealthcheck({
    GT06_PORT: '5023',
    NMEA_PORT: '5024',
    NMEA_DEVICE_MAP_JSON: '{"192.0.2.5":{}}',
  }, async port => { probed.push(port); return port === 5023; });
  assert.deepEqual(probed.sort(), [5023, 5024]);
  assert.equal(healthy, false);
});
