import { BadRequestException, Body, Controller, Headers, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { TrackingService } from '../tracking/tracking.service';
import { TrackerLocationDto } from './dto/tracker-location.dto';
import { NmeaIngestDto } from './dto/nmea-ingest.dto';
import { Gt06IngestDto } from './dto/gt06-ingest.dto';
import { parseGt06Frame, parseGt06Location } from './protocols/gt06.parser';
import { normalizeGt06Location, normalizeNmeaFix } from './protocols/normalize-location';
import { parseNmeaSentence } from './protocols/nmea.parser';

@Controller('device-gateway')
export class DeviceGatewayController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('ingest')
  ingest(@Headers('authorization') authorization: string | undefined, @Body() dto: TrackerLocationDto) {
    return this.tracking.ingestGpsTracker(authorization, dto);
  }

  /** Authenticated hardware heartbeat; refreshes last-seen without inventing a GPS fix. */
  @Post('heartbeat/gt06')
  heartbeatGt06(@Headers('authorization') authorization: string | undefined) {
    return this.tracking.recordGpsTrackerHeartbeat(authorization, 'gt06');
  }

  /** HTTPS adapter for NMEA devices or a trusted relay. */
  @Post('ingest/nmea')
  async ingestNmea(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: NmeaIngestDto,
  ) {
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new UnauthorizedException('GPS tracker credential required');
    try {
      const profile = await this.tracking.getGpsTrackerProfile(authorization);
      if (profile.protocol !== 'nmea') throw new BadRequestException('Tracker is not enrolled for NMEA');
      const fix = parseNmeaSentence(dto.sentence);
      const normalized = normalizeNmeaFix(fix, dto.pairedUtcTimestamp);
      return this.tracking.ingestGpsTracker(authorization, normalized, 'nmea');
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof UnauthorizedException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid NMEA sentence');
    }
  }

  /** HTTPS adapter for the classic GT06 0x7878 / 0x12 profile. */
  @Post('ingest/gt06')
  async ingestGt06(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: Gt06IngestDto,
  ) {
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new UnauthorizedException('GPS tracker credential required');
    try {
      const profile = await this.tracking.getGpsTrackerProfile(authorization);
      if (profile.protocol !== 'gt06') throw new BadRequestException('Tracker is not enrolled for GT06');
      if (profile.timezone_offset_minutes === null) {
        throw new ServiceUnavailableException('GT06 device timezone is not configured');
      }
      const frame = parseGt06Frame(Buffer.from(dto.frameHex, 'hex'));
      const fix = parseGt06Location(frame);
      const normalized = normalizeGt06Location(fix, profile.timezone_offset_minutes);
      return this.tracking.ingestGpsTracker(authorization, normalized, 'gt06');
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid GT06 frame');
    }
  }
}
