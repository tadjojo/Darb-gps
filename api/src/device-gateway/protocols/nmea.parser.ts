export interface NmeaFix {
  sentence: 'RMC' | 'GGA';
  latitude: number;
  longitude: number;
  speedKmh?: number;
  heading?: number;
  recordedAt?: string;
  altitudeMeters?: number;
  satellites?: number;
  fixQuality?: number;
}

function parseCoordinate(value: string, hemisphere: string, degreeDigits: number, max: number): number {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid NMEA coordinate');
  const degrees = Number(value.slice(0, degreeDigits));
  const minutes = Number(value.slice(degreeDigits));
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 60 || degrees > max || (degrees === max && minutes !== 0)) {
    throw new Error('NMEA coordinate out of range');
  }
  if (hemisphere !== (degreeDigits === 2 ? 'N' : 'E') && hemisphere !== (degreeDigits === 2 ? 'S' : 'W')) {
    throw new Error('Invalid NMEA hemisphere');
  }
  return (degrees + minutes / 60) * (hemisphere === 'S' || hemisphere === 'W' ? -1 : 1);
}

function parseUtcTime(value: string): { hour: number; minute: number; second: number; millis: number } {
  const match = /^(\d{2})(\d{2})(\d{2})(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error('Invalid NMEA UTC time');
  const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) throw new Error('NMEA UTC time out of range');
  return { hour, minute, second, millis: Number((match[4] ?? '').padEnd(3, '0').slice(0, 3)) };
}

function parseDate(value: string): { year: number; month: number; day: number } {
  if (!/^\d{6}$/.test(value)) throw new Error('Invalid NMEA date');
  const day = Number(value.slice(0, 2)), month = Number(value.slice(2, 4)), yy = Number(value.slice(4, 6));
  const year = yy >= 80 ? 1900 + yy : 2000 + yy;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || day < 1 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error('NMEA date out of range');
  }
  return { year, month, day };
}

/** Parse one checksum-protected GPRMC/GNRMC or GPGGA/GNGGA sentence. */
export function parseNmeaSentence(line: string): NmeaFix {
  const sentence = line.trim();
  const match = /^\$([^*]+)\*([0-9A-Fa-f]{2})$/.exec(sentence);
  if (!match) throw new Error('NMEA sentence must include a checksum');
  let checksum = 0;
  for (let i = 0; i < match[1].length; i++) checksum ^= match[1].charCodeAt(i);
  if (checksum !== Number.parseInt(match[2], 16)) throw new Error('NMEA checksum mismatch');
  const fields = match[1].split(',');
  const type = fields[0].slice(-3);
  if (type === 'RMC') {
    if (fields.length < 10 || fields[2] !== 'A') throw new Error('NMEA RMC has no valid fix');
    const time = parseUtcTime(fields[1]);
    const date = parseDate(fields[9]);
    const recordedAt = new Date(Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second, time.millis)).toISOString();
    const speedKnots = fields[7] === '' ? undefined : Number(fields[7]);
    const heading = fields[8] === '' ? undefined : Number(fields[8]);
    if ((speedKnots !== undefined && (!Number.isFinite(speedKnots) || speedKnots < 0)) ||
        (heading !== undefined && (!Number.isFinite(heading) || heading < 0 || heading >= 360))) throw new Error('Invalid NMEA RMC motion data');
    return {
      sentence: 'RMC',
      latitude: parseCoordinate(fields[3], fields[4], 2, 90),
      longitude: parseCoordinate(fields[5], fields[6], 3, 180),
      speedKmh: speedKnots === undefined ? undefined : speedKnots * 1.852,
      heading,
      recordedAt,
    };
  }
  if (type === 'GGA') {
    if (fields.length < 10 || Number(fields[6]) <= 0) throw new Error('NMEA GGA has no valid fix');
    parseUtcTime(fields[1]);
    const satellites = Number(fields[7]);
    const altitude = Number(fields[9]);
    if (!Number.isInteger(satellites) || satellites < 0 || !Number.isFinite(altitude)) throw new Error('Invalid NMEA GGA quality data');
    return {
      sentence: 'GGA',
      latitude: parseCoordinate(fields[2], fields[3], 2, 90),
      longitude: parseCoordinate(fields[4], fields[5], 3, 180),
      satellites,
      fixQuality: Number(fields[6]),
      altitudeMeters: altitude,
    };
  }
  throw new Error('Unsupported NMEA sentence; expected RMC or GGA');
}
