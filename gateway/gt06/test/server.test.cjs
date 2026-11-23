const test = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedAddress, parseCidr } = require('../server');

test('GT06 gateway validates IPv4 CIDR ranges', () => {
  const trusted = [parseCidr('203.0.113.0/24'), parseCidr('198.51.100.7/32')];
  assert.equal(isTrustedAddress('203.0.113.22', trusted), true);
  assert.equal(isTrustedAddress('::ffff:203.0.113.22', trusted), true);
  assert.equal(isTrustedAddress('203.0.114.22', trusted), false);
  assert.equal(isTrustedAddress('198.51.100.7', trusted), true);
  assert.equal(isTrustedAddress('198.51.100.8', trusted), false);
  assert.equal(isTrustedAddress('2001:db8::1', trusted), false);
});

test('GT06 gateway rejects invalid CIDR configuration', () => {
  assert.throws(() => parseCidr('not-an-ip/24'), /valid IPv4 CIDR/);
  assert.throws(() => parseCidr('203.0.113.0/33'), /valid IPv4 CIDR/);
  assert.throws(() => parseCidr('203.0.113.0/-1'), /valid IPv4 CIDR/);
  assert.throws(() => parseCidr('0.0.0.0/0'), /valid IPv4 CIDR/);
});
