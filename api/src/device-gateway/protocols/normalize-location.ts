import { TrackerLocationDto } from '../dto/tracker-location.dto';
import { Gt06Location } from './gt06.parser';
import { NmeaFix } from './nmea.parser';

/** Convert a GT06 device-local clock to UTC using the device's configured offset.
 * Offset is minutes east of UTC (for example +180 for UTC+03:00).
 * A fixed offset is intentional: deployments with DST must resolve the offset
 * for the recorded date from an explicit device/region profile.
 */
export function normalizeGt06Location(location: Gt06Location, timezoneOffsetMinutes: number): TrackerLocationDto {
  if (!Number.isInteger(timezoneOffsetMinutes) || timezoneOffsetMinutes < -840 || timezoneOffsetMinutes > 840) {
    throw new Error('GT06 timezone offset must be an integer between -840 and 840 minutes');
  }
  if (!location.gpsFixed) throw new Error('GT06 location does not contain a valid GPS fix');
  if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90 ||
      !Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) {
    throw new Error('GT06 coordinates are invalid');
  }
  const { year, month, day, hour, minute, second } = location.deviceTime;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const recordedAt = new Date(localAsUtc - timezoneOffsetMinutes * 60_000);
  if (!Number.isFinite(recordedAt.getTime())) throw new Error('GT06 timestamp is invalid');
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    speedKmh: location.speedKmh,
    heading: location.heading,
    recordedAt: recordedAt.toISOString(),
  };
}

/** NMEA RMC already carries a UTC timestamp. GGA needs a trusted date/time
 * pairing supplied by the stream/session layer; it is never assigned "now".
 */
export function normalizeNmeaFix(fix: NmeaFix, ggaRecordedAt?: string): TrackerLocationDto {
  const recordedAt = fix.sentence === 'RMC' ? fix.recordedAt : ggaRecordedAt;
  if (!recordedAt || !Number.isFinite(Date.parse(recordedAt))) {
    throw new Error('NMEA GGA requires a trusted paired UTC timestamp');
  }
  if (!Number.isFinite(fix.latitude) || fix.latitude < -90 || fix.latitude > 90 ||
      !Number.isFinite(fix.longitude) || fix.longitude < -180 || fix.longitude > 180) {
    throw new Error('NMEA coordinates are invalid');
  }
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    speedKmh: fix.speedKmh,
    heading: fix.heading,
    recordedAt: new Date(recordedAt).toISOString(),
  };
}
