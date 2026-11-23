import { Body, Controller, Headers, Post } from '@nestjs/common';
import { TrackingService } from '../tracking/tracking.service';
import { TrackerLocationDto } from './dto/tracker-location.dto';

@Controller('device-gateway')
export class DeviceGatewayController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('ingest')
  ingest(@Headers('authorization') authorization: string | undefined, @Body() dto: TrackerLocationDto) {
    return this.tracking.ingestGpsTracker(authorization, dto);
  }
}
