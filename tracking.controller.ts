import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { MobileLocationDto, EnrollMobileDeviceDto } from './dto/mobile-location.dto';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

class TripsQueryDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

class StopsQueryDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit = 200;
}

class EnrollGpsTrackerDto extends EnrollMobileDeviceDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
}
import { TrackingService } from './tracking.service';

@UseGuards(JwtAuthGuard)
@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('devices/enroll-mobile')
  enrollMobile(@Req() req: AuthenticatedRequest, @Body() dto: EnrollMobileDeviceDto) {
    return this.tracking.enrollMobileDevice(req.user!, dto.vehicleId);
  }

  @Post('devices/enroll-gps-tracker')
  enrollGpsTracker(@Req() req: AuthenticatedRequest, @Body() dto: EnrollGpsTrackerDto) {
    return this.tracking.enrollGpsTracker(req.user!, dto.vehicleId, dto.label);
  }

  @Post('devices/:deviceId/revoke')
  revokeDevice(@Req() req: AuthenticatedRequest, @Param('deviceId', new ParseUUIDPipe()) deviceId: string) {
    return this.tracking.revokeDevice(req.user!, deviceId);
  }

  @Post('mobile/location')
  receiveLocation(@Req() req: AuthenticatedRequest, @Body() dto: MobileLocationDto) {
    return this.tracking.ingestMobileLocation(req.user!, dto);
  }

  @Get('vehicles/:vehicleId/trips')
  trips(@Req() req: AuthenticatedRequest, @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string,
    @Query() query: TripsQueryDto) {
    return this.tracking.getTrips(req.user!, vehicleId, query.from, query.to, query.limit);
  }

  @Get('vehicles/:vehicleId/trip-route')
  tripRoute(@Req() req: AuthenticatedRequest, @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string,
    @Query('deviceId', new ParseUUIDPipe()) deviceId: string, @Query() query: TripsQueryDto) {
    return this.tracking.getTripRoute(req.user!, vehicleId, deviceId, query.from, query.to);
  }

  @Get('vehicles/:vehicleId/stops')
  stops(@Req() req: AuthenticatedRequest, @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string,
    @Query() query: StopsQueryDto) {
    return this.tracking.getStops(req.user!, vehicleId, query.from, query.to, query.limit);
  }

  @Get('vehicles/:vehicleId/latest')
  latest(@Req() req: AuthenticatedRequest, @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string) {
    return this.tracking.getLatestLocation(req.user!, vehicleId);
  }
}
