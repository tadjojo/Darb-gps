const test = require('node:test');
const assert = require('node:assert/strict');
const { Gt06StreamDecoder } = require('../dist/device-gateway/protocols/gt06-stream-decoder');
const { NmeaStreamDecoder } = require('../dist/device-gateway/protocols/nmea-stream-decoder');
const { crc16Itt, parseGt06Frame } = require('../dist/device-gateway/protocols/gt06.parser');
const { parseNmeaSentence } = require('../dist/device-gateway/protocols/nmea.parser');

function makeGt06(protocol = 0x13, payload = Buffer.from([1,2,3])) {
  const body = Buffer.concat([Buffer.from([payload.length + 5, protocol]), payload, Buffer.from([0x00,0x01])]);
  const crc = crc16Itt(body);
  return Buffer.concat([Buffer.from([0x78,0x78]), body, Buffer.from([crc >> 8, crc & 255, 0x0d, 0x0a])]);
}
function makeNmea(body) {
  let sum = 0; for (const c of body) sum ^= c.charCodeAt(0);
  return `$${body}*${sum.toString(16).padStart(2,'0').toUpperCase()}\r\n`;
}

test('GT06 stream decoder reassembles split frames and emits multiple frames', () => {
  const a = makeGt06(), b = makeGt06(0x23, Buffer.from([9,8,7,6]));
  const decoder = new Gt06StreamDecoder();
  assert.deepEqual(decoder.push(a.subarray(0, 4)), []);
  const out = decoder.push(Buffer.concat([a.subarray(4), b]));
  assert.equal(out.length, 2);
  assert.equal(parseGt06Frame(out[0]).protocol, 0x13);
  assert.equal(parseGt06Frame(out[1]).protocol, 0x23);
  assert.equal(decoder.bufferedBytes, 0);
});

test('GT06 stream decoder resynchronizes after noise and preserves partial start byte', () => {
  const frame = makeGt06();
  const decoder = new Gt06StreamDecoder();
  assert.deepEqual(decoder.push(Buffer.from([0x01,0x02,0x78])), []);
  const out = decoder.push(Buffer.concat([Buffer.from([0x78]), frame.subarray(2)]));
  assert.equal(out.length, 1);
  assert.equal(parseGt06Frame(out[0]).protocol, 0x13);
});

test('NMEA stream decoder handles split lines and multiple sentences', () => {
  const one = makeNmea('GPRMC,123519,A,4807.038,N,01131.000,E,0.0,0.0,230394,,,A');
  const two = makeNmea('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,');
  const decoder = new NmeaStreamDecoder();
  assert.deepEqual(decoder.push(one.slice(0, 17)), []);
  const lines = decoder.push(one.slice(17) + two);
  assert.equal(lines.length, 2);
  assert.equal(parseNmeaSentence(lines[0]).sentence, 'RMC');
  assert.equal(parseNmeaSentence(lines[1]).sentence, 'GGA');
});

test('NMEA stream decoder enforces line limits and control characters', () => {
  const decoder = new NmeaStreamDecoder(32);
  assert.throws(() => decoder.push('A'.repeat(33)), /maximum length/);
  assert.throws(() => new NmeaStreamDecoder().push('bad\u0001line'), /control characters/);
});
