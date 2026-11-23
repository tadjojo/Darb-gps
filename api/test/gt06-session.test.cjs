const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGt06Frame, parseGt06Login, buildGt06Ack, crc16Itt } = require('../dist/device-gateway/protocols/gt06.parser');
const { handleGt06SessionFrame } = require('../dist/device-gateway/protocols/gt06-session');

const loginHex = '78780D010353419032332707004B7DB80D0A';
function makeFrame(protocol, payload, serial = 1) {
  const body = Buffer.concat([Buffer.from([payload.length + 5, protocol]), payload,
    Buffer.from([(serial >> 8) & 255, serial & 255])]);
  const crc = crc16Itt(body);
  return Buffer.concat([Buffer.from([0x78, 0x78]), body,
    Buffer.from([crc >> 8, crc & 255, 0x0d, 0x0a])]);
}

test('GT06 login decodes the registered 15-digit IMEI from BCD', () => {
  const frame = parseGt06Frame(Buffer.from(loginHex, 'hex'));
  const login = parseGt06Login(frame);
  assert.equal(login.imei, '353419032332707');
  assert.equal(login.serial, 0x004b);
});

test('GT06 acknowledgement matches the standard login ACK vector', () => {
  assert.equal(buildGt06Ack(0x01, 0x0001).toString('hex').toUpperCase(), '787805010001D9DC0D0A');
});

test('GT06 session authenticates matching IMEI and rejects a mismatch', () => {
  const frame = parseGt06Frame(Buffer.from(loginHex, 'hex'));
  const accepted = handleGt06SessionFrame(frame, '353419032332707', false);
  assert.equal(accepted.authenticated, true);
  assert.equal(accepted.close, false);
  assert.equal(accepted.ack.toString('hex').toUpperCase(), buildGt06Ack(0x01, 0x004b).toString('hex').toUpperCase());
  const rejected = handleGt06SessionFrame(frame, '123456789012345', false);
  assert.equal(rejected.authenticated, false);
  assert.equal(rejected.close, true);
  assert.equal(rejected.ack, undefined);
});

test('GT06 session refuses non-login packets before authentication', () => {
  const frame = parseGt06Frame(makeFrame(0x13, Buffer.from([0x46, 0x06, 0x04]), 0x8c8b));
  const result = handleGt06SessionFrame(frame, '353419032332707', false);
  assert.equal(result.close, true);
  assert.equal(result.ack, undefined);
});

test('GT06 login rejects unsupported BCD payloads', () => {
  const frame = { protocol: 0x01, serial: 1, payload: Buffer.from('03534190323327AF', 'hex'), raw: Buffer.alloc(0) };
  assert.throws(() => parseGt06Login(frame), /valid BCD/);
});

test('GT06 extended login frame receives an extended-format acknowledgement', () => {
  const payload = Buffer.from('0353419032332707', 'hex');
  const body = Buffer.concat([Buffer.from([0x00, 0x0d, 0x01]), payload, Buffer.from([0x00, 0x4b])]);
  const { crc16Itt } = require('../dist/device-gateway/protocols/gt06.parser');
  const crc = crc16Itt(body);
  const raw = Buffer.concat([Buffer.from([0x79, 0x79]), body, Buffer.from([crc >> 8, crc & 255, 0x0d, 0x0a])]);
  const frame = parseGt06Frame(raw);
  const result = handleGt06SessionFrame(frame, '353419032332707', false);
  assert.equal(result.authenticated, true);
  assert.equal(result.ack[0], 0x79);
  assert.equal(result.ack[1], 0x79);
  assert.equal(result.ack.readUInt16BE(2), 5);
});

test('GT06 extended heartbeat keeps extended framing in its ACK', () => {
  const { crc16Itt } = require('../dist/device-gateway/protocols/gt06.parser');
  const body = Buffer.from([0x00, 0x08, 0x13, 0x46, 0x06, 0x04, 0x00, 0x2a]);
  const crc = crc16Itt(body);
  const raw = Buffer.concat([Buffer.from([0x79, 0x79]), body, Buffer.from([crc >> 8, crc & 255, 0x0d, 0x0a])]);
  const frame = parseGt06Frame(raw);
  const result = handleGt06SessionFrame(frame, '353419032332707', true);
  assert.equal(result.authenticated, true);
  assert.equal(result.ack[0], 0x79);
  assert.equal(result.ack[1], 0x79);
  assert.equal(result.ack.readUInt16BE(2), 5);
});
