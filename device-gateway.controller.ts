import { Body, Controller, Headers, Post } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { DeviceGatewayService } from './device-gateway.service';

class TrackerIngestDto {
  @IsIn(['nmea0183', 'gt06', 'json']) protocol!: 'nmea0183' | 'gt06' | 'json';
  @IsString() @MinLength(8) @MaxLength(8192) payload!: string;
}

@Controller('device-gateway')
export class DeviceGatewayController {
  constructor(private readonly gateway: DeviceGatewayService) {}
  @Post('ingest') ingest(@Headers('authorization') authorization: string | undefined, @Body() dto: TrackerIngestDto) {
    return this.gateway.ingest(authorization, dto.protocol, dto.payload);
  }
}
