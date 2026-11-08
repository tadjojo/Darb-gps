import { BadRequestException, Injectable } from '@nestjs/common';
import { NormalizedTrackerFix, TrackerProtocolAdapter } from '../protocol.types';

function coordinate(raw: string, hemisphere: string, degreeDigits: number): number {
  if (!new RegExp(`^\\d{${degreeDigits}}\\d{2}\\.\\d+$`).test(raw)) throw new Error('Invalid NMEA coordinate');
  const degrees = Number(raw.slice(0, degreeDigits));
  const minutes = Number(raw.slice(degreeDigits));
  if (minutes >= 60) throw new Error('Invalid NMEA minutes');
  let value = degrees + minutes / 60;
  if (hemisphere === 'S' || hemisphere === 'W') value *= -1;
  else if (hemisphere !== 'N' && hemisphere !== 'E') throw new Error('Invalid NMEA hemisphere');
  if (Math.abs(value) > (degreeDigits === 2 ? 90 : 180)) throw new Error('NMEA coordinate out of range');
  return value;
}

function parseUtc(time: string, date: string): Date {
  if (!/^\d{6}(?:\.\d+)?$/.test(time) || !/^\d{6}$/.test(date)) throw new Error('Invalid NMEA UTC date/time');
  const day = Number(date.slice(0, 2)); const month = Number(date.slice(2, 4));
  const yy = Number(date.slice(4, 6)); const year = yy >= 80 ? 1900 + yy : 2000 + yy;
  const hh = Number(time.slice(0, 2)); const mm = Number(time.slice(2, 4)); const ss = Number(time.slice(4, 6));
  const ms = time.includes('.') ? Number(`0${time.slice(time.indexOf('.'))}`) * 1000 : 0;
  const result = new Date(Date.UTC(year, month - 1, day, hh, mm, ss, Math.floor(ms)));
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day || hh > 23 || mm > 59 || ss > 59) throw new Error('Invalid NMEA calendar value');
  return result;
}

@Injectable()
export class Nmea0183Adapter implements TrackerProtocolAdapter {
  readonly protocol = 'nmea0183' as const;
  parse(payload: string): NormalizedTrackerFix {
    try {
      const line = payload.trim().split(/\r?\n/).find(value => /^\$..RMC,/.test(value));
      if (!line) throw new Error('No RMC sentence found');
      const star = line.indexOf('*');
      if (star < 0 || !/^[0-9A-Fa-f]{2}$/.test(line.slice(star + 1))) throw new Error('NMEA checksum is required');
      let checksum = 0;
      for (const char of line.slice(1, star)) checksum ^= char.charCodeAt(0);
      if (checksum !== parseInt(line.slice(star + 1), 16)) throw new Error('NMEA checksum mismatch');
      const fields = line.slice(1, star).split(',');
      if (fields[2] !== 'A') throw new Error('NMEA fix is invalid');
      const latitude = coordinate(fields[3], fields[4], 2);
      const longitude = coordinate(fields[5], fields[6], 3);
      const knots = fields[7] ? Number(fields[7]) : NaN;
      const course = fields[8] ? Number(fields[8]) : NaN;
      if (fields[7] && (!Number.isFinite(knots) || knots < 0 || knots * 1.852 > 400)) throw new Error('Invalid NMEA speed');
      if (fields[8] && (!Number.isFinite(course) || course < 0 || course > 360)) throw new Error('Invalid NMEA course');
      return { latitude, longitude, speedKmh: Number.isFinite(knots) ? knots * 1.852 : null,
        heading: Number.isFinite(course) ? course : null, accuracyMeters: 25,
        recordedAt: parseUtc(fields[1], fields[9]) };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid NMEA payload');
    }
  }
}
