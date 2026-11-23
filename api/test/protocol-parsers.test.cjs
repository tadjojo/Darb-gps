const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNmeaSentence } = require('../dist/device-gateway/protocols/nmea.parser');
const { crc16Itt, parseGt06Frame, parseGt06Location } = require('../dist/device-gateway/protocols/gt06.parser');
const { normalizeGt06Location, normalizeNmeaFix } = require('../dist/device-gateway/protocols/normalize-location');

function nmea(body) {
  let checksum = 0;
  for (const char of body) checksum ^= char.charCodeAt(0);
  return `$${body}*${checksum.toString(16).padStart(2, '0').toUpperCase()}`;
}

test('NMEA RMC validates checksum and converts knots to km/h', () => {
  const fix = parseNmeaSentence(nmea('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W'));
  assert.equal(fix.sentence, 'RMC');
  assert.ok(Math.abs(fix.latitude - 48.1173) < 0.000001);
  assert.ok(Math.abs(fix.longitude - 11.5166667) < 0.000001);
  assert.ok(Math.abs(fix.speedKmh - 41.4848) < 0.001);
  assert.equal(fix.recordedAt, '1994-03-23T12:35:19.000Z');
  assert.equal(normalizeNmeaFix(fix).recordedAt, fix.recordedAt);
});

test('NMEA GGA requires a trusted paired UTC timestamp', () => {
  const fix = parseNmeaSentence(nmea('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,'));
  assert.equal(fix.satellites, 8);
  assert.equal(fix.altitudeMeters, 545.4);
  assert.throws(() => normalizeNmeaFix(fix), /trusted paired UTC timestamp/);
  assert.equal(normalizeNmeaFix(fix, '2026-11-23T12:35:19.000Z').recordedAt, '2026-11-23T12:35:19.000Z');
  assert.throws(() => parseNmeaSentence(nmea('GPGGA,123519,4807.038,N,01131.000,E,0,00,9.9,0.0,M,0.0,M,,')));
});

test('NMEA rejects checksum corruption and invalid status', () => {
  const valid = nmea('GPRMC,123519,A,4807.038,N,01131.000,E,0.0,0.0,230394,,,A');
  assert.throws(() => parseNmeaSentence(valid.slice(0, -2) + '00'));
  assert.throws(() => parseNmeaSentence(nmea('GPRMC,123519,V,4807.038,N,01131.000,E,0.0,0.0,230394,,,A')));
});

test('GT06 validates CRC and decodes common 0x12 location packet', () => {
  const payload = Buffer.from([0x1a,0x02,0x0c,0x0a,0x1e,0x32,0xcf,0x02,0x7a,0xc7,0xeb,0x0c,0x46,0x58,0x49,0x00,0x14,0x8f,0x01,0xcc,0x00,0x28,0x7d,0x00,0x1f,0xb8]);
  const body = Buffer.concat([Buffer.from([payload.length + 5, 0x12]), payload, Buffer.from([0x00,0x03])]);
  const crc = crc16Itt(body);
  const frame = Buffer.concat([Buffer.from([0x78,0x78]), body, Buffer.from([crc >> 8, crc & 0xff, 0x0d, 0x0a])]);
  const parsed = parseGt06Frame(frame);
  const fix = parseGt06Location(parsed);
  assert.equal(parsed.protocol, 0x12);
  assert.equal(parsed.serial, 3);
  assert.ok(Math.abs(fix.latitude - 23.111668) < 0.00001);
  assert.ok(Math.abs(fix.longitude - 114.409285) < 0.00001);
  assert.equal(fix.heading, 143);
  assert.equal(fix.gpsFixed, true);
  const normalized = normalizeGt06Location(fix, 480);
  assert.equal(normalized.recordedAt, '2026-02-11T02:30:50.000Z');
  assert.throws(() => normalizeGt06Location({ ...fix, gpsFixed: false }, 180), /valid GPS fix/);
  assert.throws(() => normalizeGt06Location(fix, 9999), /timezone offset/);
  assert.throws(() => parseGt06Frame(Buffer.from([...frame.slice(0, -4), 0, 0, 0x0d, 0x0a])));
});

test('GT06 rejects malformed frames and unsupported packet types', () => {
  assert.throws(() => parseGt06Frame(Buffer.from([0x78,0x78,0x05,0x01])));
  assert.throws(() => parseGt06Frame(Buffer.from([0x79,0x79,0x00,0x05,0x01,0,1,0,0,0x0d,0x0a])));
});
