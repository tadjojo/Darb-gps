const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGt06Frame, parseGt06Login, buildGt06Ack } = require('../dist/device-gateway/protocols/gt06.parser');
const { handleGt06SessionFrame } = require('../dist/device-gateway/protocols/gt06-session');

const loginHex = '78780D010353419032332707004B7DB80D0A';

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
  const frame = parseGt06Frame(Buffer.from('78780813460604098C8B820D0A', 'hex'));
  const result = handleGt06SessionFrame(frame, '353419032332707', false);
  assert.equal(result.close, true);
  assert.equal(result.ack, undefined);
});

test('GT06 login rejects unsupported BCD payloads', () => {
  const frame = { protocol: 0x01, serial: 1, payload: Buffer.from('03534190323327AF', 'hex'), raw: Buffer.alloc(0) };
  assert.throws(() => parseGt06Login(frame), /valid BCD/);
});
