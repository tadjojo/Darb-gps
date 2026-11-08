import { Nmea0183Adapter } from '../../src/device-gateway/adapters/nmea0183.adapter';
import { Gt06Adapter } from '../../src/device-gateway/adapters/gt06.adapter';
import { JsonTrackerAdapter } from '../../src/device-gateway/adapters/json.adapter';

function crc16(buffer: Buffer): number {
  let crc = 0xffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0x8408 : crc >>> 1; }
  return (~crc) & 0xffff;
}
function gt06Frame(status = 0x1400 | 90): string {
  const frame = Buffer.alloc(36);
  frame[0] = 0x78; frame[1] = 0x78; frame[2] = 31; frame[3] = 0x12;
  frame[4] = 26; frame[5] = 11; frame[6] = 5; frame[7] = 12; frame[8] = 30; frame[9] = 0;
  frame[10] = 0xc8; // 12-byte GPS info, 8 satellites
  frame.writeUInt32BE(Math.round(31.9539 * 1_800_000), 11);
  frame.writeUInt32BE(Math.round(35.9106 * 1_800_000), 15);
  frame[19] = 60;
  frame.writeUInt16BE(status, 20); // course/status word
  frame[30] = 0x00; frame[31] = 0x01;
  frame.writeUInt16BE(crc16(frame.subarray(2, 32)), 32);
  frame[34] = 0x0d; frame[35] = 0x0a;
  return frame.toString('hex');
}

describe('Independent tracker protocol adapters', () => {
  it('parses a checksummed NMEA RMC sentence', () => {
    const fix = new Nmea0183Adapter().parse('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A');
    expect(fix.latitude).toBeCloseTo(48.1173, 4);
    expect(fix.longitude).toBeCloseTo(11.5166667, 4);
    expect(fix.speedKmh).toBeCloseTo(41.4848, 3);
    expect(fix.heading).toBeCloseTo(84.4, 1);
    expect(fix.recordedAt.toISOString()).toBe('1994-03-23T12:35:19.000Z');
  });

  it('rejects an NMEA checksum mismatch and invalid fix', () => {
    expect(() => new Nmea0183Adapter().parse('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*00')).toThrow();
    expect(() => new Nmea0183Adapter().parse('$GPRMC,123519,V,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*7D')).toThrow();
  });

  it('parses a framed GT06 location packet and validates its CRC', () => {
    const adapter = new Gt06Adapter();
    const fix = adapter.parse(gt06Frame());
    expect(fix.latitude).toBeCloseTo(31.9539, 4);
    expect(fix.longitude).toBeCloseTo(35.9106, 4);
    expect(fix.speedKmh).toBe(60);
    expect(fix.heading).toBe(90);
    const vendorSample = adapter.parse('78781f120b081d112e10cf027ac7eb0c46584900148f01cc00287d001fb8000380810d0a');
    expect(vendorSample.heading).toBe(143);
    expect(vendorSample.latitude).toBeGreaterThan(0);
    expect(vendorSample.longitude).toBeGreaterThan(0);
    const southWest = adapter.parse(gt06Frame(0x1800 | 90));
    expect(southWest.latitude).toBeLessThan(0);
    expect(southWest.longitude).toBeLessThan(0);
    expect(() => adapter.parse(gt06Frame(0x0800 | 90))).toThrow(); // GPS fix bit absent
    const broken = gt06Frame().slice(0, -4) + '0000' + '0d0a';
    expect(() => adapter.parse(broken)).toThrow();
  });

  it('parses the normalized JSON tracker protocol and rejects invalid coordinates', () => {
    const adapter = new JsonTrackerAdapter();
    const fix = adapter.parse(JSON.stringify({ latitude: 31.95, longitude: 35.91, speedKmh: 45, heading: 180, accuracyMeters: 8, recordedAt: '2026-11-05T10:00:00Z', batteryPercent: 87, signalStrengthDbm: -76, networkType: 'LTE' }));
    expect(fix.latitude).toBe(31.95);
    expect(fix.speedKmh).toBe(45);
    expect(fix.batteryPercent).toBe(87);
    expect(fix.signalStrengthDbm).toBe(-76);
    expect(fix.networkType).toBe('LTE');
    expect(() => adapter.parse(JSON.stringify({ latitude: 31, longitude: 35, recordedAt: '2026-11-05T10:00:00Z', batteryPercent: 150 }))).toThrow();
    expect(() => adapter.parse('{"latitude":91,"longitude":0,"recordedAt":"2026-11-05T10:00:00Z"}')).toThrow();
  });
});
