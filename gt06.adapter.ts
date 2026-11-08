import { BadRequestException, Injectable } from '@nestjs/common';
import { NormalizedTrackerFix, TrackerProtocolAdapter } from '../protocol.types';

function crc16Itu(buffer: Buffer): number {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return (~crc) & 0xffff;
}

@Injectable()
export class Gt06Adapter implements TrackerProtocolAdapter {
  readonly protocol = 'gt06' as const;
  parse(payload: string): NormalizedTrackerFix {
    try {
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(payload)) throw new Error('GT06 payload must be hexadecimal');
      const frame = Buffer.from(payload, 'hex');
      if (frame.length < 36 || frame[0] !== 0x78 || frame[1] !== 0x78 || frame[frame.length - 2] !== 0x0d || frame[frame.length - 1] !== 0x0a) throw new Error('Invalid GT06 frame boundaries');
      if (frame[3] !== 0x12) throw new Error('GT06 frame is not a location packet (0x12)');
      const declaredLength = frame[2];
      if (declaredLength + 5 !== frame.length) throw new Error('GT06 frame length mismatch');
      const expectedCrc = frame.readUInt16BE(frame.length - 4);
      const actualCrc = crc16Itu(frame.subarray(2, frame.length - 4));
      if (expectedCrc !== actualCrc) throw new Error('GT06 CRC mismatch');
      const year = 2000 + frame[4]; const month = frame[5]; const day = frame[6];
      const hour = frame[7]; const minute = frame[8]; const second = frame[9];
      const recordedAt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      if (recordedAt.getUTCMonth() !== month - 1 || recordedAt.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw new Error('Invalid GT06 timestamp');
      const gpsInfo = frame[10];
      if ((gpsInfo >>> 4) < 12 || (gpsInfo & 0x0f) === 0) throw new Error('GT06 GPS information length or satellite count is invalid');
      const latitudeRaw = frame.readUInt32BE(11);
      const longitudeRaw = frame.readUInt32BE(15);
      const speedKmh = frame[19];
      const courseStatus = frame.readUInt16BE(20);
      let latitude = latitudeRaw / 1_800_000;
      let longitude = longitudeRaw / 1_800_000;
      // GT06 BYTE_1 bit 2 (overall 0x0400): north when set;
      // BYTE_1 bit 3 (overall 0x0800): west when set. BYTE_1 bit 4
      // (overall 0x1000) indicates that a GPS fix has been obtained.
      if ((courseStatus & 0x1000) === 0) throw new Error('GT06 packet does not contain a valid GPS fix');
      if ((courseStatus & 0x0400) === 0) latitude *= -1;
      if ((courseStatus & 0x0800) !== 0) longitude *= -1;
      const heading = courseStatus & 0x03ff;
      if (latitude > 90 || longitude > 180 || heading > 360) throw new Error('GT06 coordinates/course out of range');
      return { latitude, longitude, speedKmh, heading, accuracyMeters: 30, recordedAt };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid GT06 payload');
    }
  }
}
