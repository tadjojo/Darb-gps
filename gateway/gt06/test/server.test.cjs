const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { isTrustedAddress, isCidrContained, parseCidr, loadConfig, createGateway, createNmeaGateway } = require('../server');
const { crc16Itt, buildGt06Ack } = require('../../../api/dist/device-gateway/protocols/gt06.parser');

test('GT06 gateway validates IPv4 CIDR ranges', () => {
  const trusted = [parseCidr('203.0.113.0/24'), parseCidr('198.51.100.7/32')];
  assert.equal(isTrustedAddress('203.0.113.22', trusted), true);
  assert.equal(isTrustedAddress('::ffff:203.0.113.22', trusted), true);
  assert.equal(isTrustedAddress('203.0.114.22', trusted), false);
  assert.equal(isTrustedAddress('198.51.100.7', trusted), true);
  assert.equal(isTrustedAddress('198.51.100.8', trusted), false);
  assert.equal(isTrustedAddress('2001:db8::1', trusted), false);
});

test('GPS gateway configuration requires device CIDRs to be contained by the trusted network', () => {
  const trusted = parseCidr('10.20.0.0/16');
  assert.equal(isCidrContained(parseCidr('10.20.30.0/24'), trusted), true);
  assert.equal(isCidrContained(parseCidr('10.20.30.41/32'), trusted), true);
  assert.equal(isCidrContained(parseCidr('10.21.30.0/24'), trusted), false);
  assert.equal(isCidrContained(parseCidr('10.20.0.0/8'), trusted), false);
});

test('GT06 gateway rejects invalid and unrestricted CIDR configuration', () => {
  assert.throws(() => parseCidr('not-an-ip/24'), /valid IPv4 CIDR/);
  assert.throws(() => parseCidr('203.0.113.0/33'), /valid IPv4 CIDR/);
  assert.throws(() => parseCidr('203.0.113.0/-1'), /valid IPv4 CIDR/);
  assert.throws(() => parseCidr('0.0.0.0/0'), /valid IPv4 CIDR/);
});

function makeFrame(protocol, payload, serial = 1) {
  const body = Buffer.concat([Buffer.from([payload.length + 5, protocol]), payload,
    Buffer.from([(serial >> 8) & 255, serial & 255])]);
  const crc = crc16Itt(body);
  return Buffer.concat([Buffer.from([0x78, 0x78]), body,
    Buffer.from([crc >> 8, crc & 255, 0x0d, 0x0a])]);
}

function nextSocketData(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for GT06 ACK')), 3000);
    socket.once('data', data => { clearTimeout(timer); resolve(data); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

test('GT06 TCP gateway logs in, forwards heartbeat/location, and ACKs only accepted packets', async () => {
  const calls = [];
  const imei = '353419032332707';
  const token = 'test-device-bearer-token-0123456789';
  const server = createGateway({
    apiBase: 'https://darb-api.example/api/v1',
    devices: new Map([[imei, { imei, bearerToken: token, sourceRanges: [parseCidr('127.0.0.1/32')] }]]),
    trustedRanges: [parseCidr('127.0.0.1/32')],
    maxConnections: 10,
    idleTimeoutMs: 30000,
  }, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => '' };
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = net.createConnection(server.address().port, '127.0.0.1');
  try {
    await once(socket, 'connect');
    const login = makeFrame(0x01, Buffer.from('0353419032332707', 'hex'), 0x004b);
    const loginAck = nextSocketData(socket);
    socket.write(login);
    assert.deepEqual(await loginAck, buildGt06Ack(0x01, 0x004b));

    const heartbeat = makeFrame(0x13, Buffer.from([0x46, 0x06, 0x04]), 0x004c);
    const heartbeatAck = nextSocketData(socket);
    socket.write(heartbeat);
    assert.deepEqual(await heartbeatAck, buildGt06Ack(0x13, 0x004c));

    const payload = Buffer.from([0x1a,0x02,0x0c,0x0a,0x1e,0x32,0xcf,0x02,0x7a,0xc7,0xeb,0x0c,0x46,0x58,0x49,0x00,0x14,0x8f,0x01,0xcc,0x00,0x28,0x7d,0x00,0x1f,0xb8]);
    const location = makeFrame(0x12, payload, 0x004d);
    const locationAck = nextSocketData(socket);
    socket.write(location);
    assert.deepEqual(await locationAck, buildGt06Ack(0x12, 0x004d));

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://darb-api.example/api/v1/device-gateway/heartbeat/gt06');
    assert.equal(calls[1].url, 'https://darb-api.example/api/v1/device-gateway/ingest/gt06');
    for (const call of calls) assert.equal(call.options.headers.authorization, 'Bearer ' + token);
    assert.deepEqual(JSON.parse(calls[1].options.body), { frameHex: location.toString('hex') });
  } finally {
    socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

test('GT06 gateway rejects an enrolled IMEI from a different trusted APN source address', async () => {
  const calls = [];
  const imei = '353419032332707';
  const server = createGateway({
    apiBase: 'https://darb-api.example/api/v1',
    devices: new Map([[imei, {
      imei,
      bearerToken: 'test-device-bearer-token-0123456789',
      sourceRanges: [parseCidr('127.0.0.2/32')],
    }]]),
    trustedRanges: [parseCidr('127.0.0.1/32')],
    maxConnections: 10,
    idleTimeoutMs: 30000,
  }, async () => {
    calls.push(true);
    return { ok: true, status: 200, text: async () => '' };
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = net.createConnection(server.address().port, '127.0.0.1');
  try {
    await once(socket, 'connect');
    const closed = once(socket, 'close');
    socket.write(makeFrame(0x01, Buffer.from('0353419032332707', 'hex'), 0x004e));
    await closed;
    assert.equal(calls.length, 0);
  } finally {
    socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

function makeNmea(body) {
  let checksum = 0;
  for (const character of body) checksum ^= character.charCodeAt(0);
  return '$' + body + '*' + checksum.toString(16).padStart(2, '0').toUpperCase() + String.fromCharCode(13, 10);
}

test('NMEA TCP gateway maps a trusted source IP and forwards RMC with paired GGA', async () => {
  const calls = [];
  let resolveCalls;
  const bothCalls = new Promise(resolve => { resolveCalls = resolve; });
  const token = 'test-nmea-device-bearer-token-012345';
  const server = createNmeaGateway({
    apiBase: 'https://darb-api.example/api/v1',
    nmeaDevices: new Map([['127.0.0.1', { sourceIp: '127.0.0.1', bearerToken: token }]]),
    trustedRanges: [parseCidr('127.0.0.1/32')],
    maxConnections: 10,
    idleTimeoutMs: 30000,
  }, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 2) resolveCalls();
    return { ok: true, status: 200, text: async () => '' };
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = net.createConnection(server.address().port, '127.0.0.1');
  try {
    await once(socket, 'connect');
    const rmc = makeNmea('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,,A');
    const gga = makeNmea('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,');
    socket.write(rmc + gga);
    await Promise.race([bothCalls, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Timed out waiting for NMEA forwarding')), 3000); timer.unref(); })]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://darb-api.example/api/v1/device-gateway/ingest/nmea');
    assert.equal(calls[1].url, calls[0].url);
    assert.equal(calls[0].options.headers.authorization, 'Bearer ' + token);
    assert.equal(calls[1].options.headers.authorization, 'Bearer ' + token);
    assert.deepEqual(JSON.parse(calls[0].options.body), { sentence: rmc.trim() });
    assert.deepEqual(JSON.parse(calls[1].options.body), { sentence: gga.trim(), pairedUtcTimestamp: '1994-03-23T12:35:19.000Z' });
  } finally {
    socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

function withGatewayEnv(values, callback) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  try {
    callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('loadConfig rejects GT06 source CIDRs outside the trusted APN/VPN ranges', () => {
  withGatewayEnv({
    DARB_API_BASE_URL: 'https://darb-api.example/api/v1',
    TRUSTED_DEVICE_CIDRS: '10.20.0.0/16',
    GT06_DEVICE_MAP_JSON: JSON.stringify({
      '353419032332707': {
        bearerToken: 'gt06-test-bearer-token-0123456789',
        sourceCidrs: ['10.21.1.2/32'],
      },
    }),
    NMEA_DEVICE_MAP_JSON: '{}',
  }, () => assert.throws(loadConfig, /fully contained within TRUSTED_DEVICE_CIDRS/));
});

test('loadConfig rejects NMEA source IPs outside the trusted APN/VPN ranges', () => {
  withGatewayEnv({
    DARB_API_BASE_URL: 'https://darb-api.example/api/v1',
    TRUSTED_DEVICE_CIDRS: '10.20.0.0/16',
    GT06_DEVICE_MAP_JSON: JSON.stringify({
      '353419032332707': {
        bearerToken: 'gt06-test-bearer-token-0123456789',
        sourceCidrs: ['10.20.1.2/32'],
      },
    }),
    NMEA_DEVICE_MAP_JSON: JSON.stringify({
      '192.0.2.10': { bearerToken: 'nmea-test-bearer-token-0123456789' },
    }),
  }, () => assert.throws(loadConfig, /NMEA source IP must be inside TRUSTED_DEVICE_CIDRS/));
});

test('loadConfig rejects bearer token reuse across enrolled GPS devices', () => {
  const token = 'shared-test-bearer-token-0123456789';
  withGatewayEnv({
    DARB_API_BASE_URL: 'https://darb-api.example/api/v1',
    TRUSTED_DEVICE_CIDRS: '10.20.0.0/16',
    GT06_DEVICE_MAP_JSON: JSON.stringify({
      '353419032332707': { bearerToken: token, sourceCidrs: ['10.20.1.2/32'] },
    }),
    NMEA_DEVICE_MAP_JSON: JSON.stringify({
      '10.20.1.3': { bearerToken: token },
    }),
  }, () => assert.throws(loadConfig, /unique bearer token/));
});
