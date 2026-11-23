import { Body, Controller, Headers, Post } from '@nestjs/common';
import { TrackingService } from '../tracking/tracking.service';
import { IngestLocationDto } from '../tracking/dto/ingest-location.dto';

@Controller('device-gateway')
export class DeviceGatewayController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('ingest')
  ingest(@Headers('authorization') authorization: string | undefined, @Body() dto: IngestLocationDto) {
    return this.tracking.ingestGpsTracker(authorization, dto);
  }
}
