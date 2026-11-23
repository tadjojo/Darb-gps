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

  /** HTTPS adapter for NMEA devices or a trusted TCP relay. */
  @Post('ingest/nmea')
  ingestNmea(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: NmeaIngestDto,
  ) {
    if (!authorization || !/^Bearer\\s+\\S+$/i.test(authorization)) throw new UnauthorizedException('GPS tracker credential required');
    try {
      const fix = parseNmeaSentence(dto.sentence);
      const normalized = normalizeNmeaFix(fix, dto.pairedUtcTimestamp);
      return this.tracking.ingestGpsTracker(authorization, normalized);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid NMEA sentence');
    }
  }

  /**
   * HTTPS adapter for classic GT06 0x7878 location frames.
   * A single configured UTC offset is used in this first version; fleets across
   * time zones require per-device timezone profiles before production rollout.
   */
  @Post('ingest/gt06')
  ingestGt06(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: Gt06IngestDto,
  ) {
    if (!authorization || !/^Bearer\\s+\\S+$/i.test(authorization)) throw new UnauthorizedException('GPS tracker credential required');
    const offsetValue = process.env.GT06_TIMEZONE_OFFSET_MINUTES;
    if (offsetValue === undefined || !/^-?\d+$/.test(offsetValue)) {
      throw new ServiceUnavailableException('GT06_TIMEZONE_OFFSET_MINUTES must be configured before GT06 ingestion');
    }
    try {
      const frame = parseGt06Frame(Buffer.from(dto.frameHex, 'hex'));
      const fix = parseGt06Location(frame);
      const normalized = normalizeGt06Location(fix, Number(offsetValue));
      return this.tracking.ingestGpsTracker(authorization, normalized);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid GT06 frame');
    }
  }
}
