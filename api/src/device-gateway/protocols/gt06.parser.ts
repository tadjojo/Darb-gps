export interface Gt06Frame {
  protocol: number;
  serial: number;
  payload: Buffer;
  raw: Buffer;
}

export interface Gt06Location {
  deviceTime: { year: number; month: number; day: number; hour: number; minute: number; second: number };
  satellites: number;
  latitude: number;
  longitude: number;
  speedKmh: number;
  heading: number;
  gpsFixed: boolean;
}

export function crc16Itt(data: Buffer): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return (crc ^ 0xffff) & 0xffff;
}

/** Decode one classic 0x7878 GT06 frame. Stream reassembly belongs to the TCP adapter. */
export function parseGt06Frame(input: Buffer): Gt06Frame {
  if (input.length < 10 || input[0] !== 0x78 || input[1] !== 0x78) throw new Error('Invalid GT06 start or truncated frame');
  const length = input[2];
  const expectedLength = length + 5;
  if (length < 5 || input.length !== expectedLength) throw new Error('Invalid GT06 frame length');
  if (input[input.length - 2] !== 0x0d || input[input.length - 1] !== 0x0a) throw new Error('Invalid GT06 stop bits');
  const crcOffset = input.length - 4;
  const expectedCrc = crc16Itt(input.subarray(2, crcOffset));
  const receivedCrc = input.readUInt16BE(crcOffset);
  if (receivedCrc !== expectedCrc) throw new Error('GT06 CRC-ITU mismatch');
  const protocol = input[3];
  const serialOffset = crcOffset - 2;
  return {
    protocol,
    serial: input.readUInt16BE(serialOffset),
    payload: Buffer.from(input.subarray(4, serialOffset)),
    raw: Buffer.from(input),
  };
}

/**
 * Decode the common 0x12 location layout only. Vendor extensions and variants
 * with a terminal ID embedded in location packets must use a model-specific profile.
 * The device clock is returned as components: timezone is deliberately not guessed.
 */
export function parseGt06Location(frame: Gt06Frame): Gt06Location {
  if (frame.protocol !== 0x12) throw new Error('GT06 frame is not a 0x12 location packet');
  const p = frame.payload;
  if (p.length < 18) throw new Error('GT06 location payload is truncated');
  const year = 2000 + p[0];
  const month = p[1], day = p[2], hour = p[3], minute = p[4], second = p[5];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 ||
      date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Invalid GT06 device date/time');
  }
  const satellites = p[6] & 0x0f;
  const latitudeRaw = p.readUInt32BE(7);
  const longitudeRaw = p.readUInt32BE(11);
  const speedKmh = p[15];
  const courseStatus = p.readUInt16BE(16);
  const flags = p[16];
  const gpsFixed = (flags & 0x10) !== 0;
  const longitudeEast = (flags & 0x08) === 0;
  const latitudeNorth = (flags & 0x04) !== 0;
  const latitude = latitudeRaw / 1_800_000 * (latitudeNorth ? 1 : -1);
  const longitude = longitudeRaw / 1_800_000 * (longitudeEast ? 1 : -1);
  if (latitudeRaw > 90 * 1_800_000 || longitudeRaw > 180 * 1_800_000) throw new Error('GT06 coordinates out of range');
  return {
    deviceTime: { year, month, day, hour, minute, second },
    satellites,
    latitude,
    longitude,
    speedKmh,
    heading: courseStatus & 0x03ff,
    gpsFixed,
  };
}
