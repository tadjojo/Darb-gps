import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { IngestLocationDto } from './dto/ingest-location.dto';
import { EnrollGpsTrackerDto } from './dto/enroll-gps-tracker.dto';
import { TrackingService } from './tracking.service';

@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('devices/enroll-mobile')
  enrollMobile(@CurrentUser() user: AuthenticatedUser, @Body() dto: EnrollGpsTrackerDto) {
    return this.tracking.enrollMobileDevice(user, dto.vehicleId);
  }

  @Get('devices/vehicle/:vehicleId')
  listDevices(@CurrentUser() user: AuthenticatedUser, @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string) {
    return this.tracking.listDevices(user, vehicleId);
  }

    @Post('devices/gps')
  enrollGpsTracker(@CurrentUser() user: AuthenticatedUser, @Body() dto: EnrollGpsTrackerDto) {
    return this.tracking.enrollGpsTracker(user, dto.vehicleId, dto.label);
  }

  @Post('devices/gps/:deviceId/revoke')
  revokeGpsTracker(@CurrentUser() user: AuthenticatedUser, @Param('deviceId', new ParseUUIDPipe()) deviceId: string) {
    return this.tracking.revokeGpsTracker(user, deviceId);
  }

  @Post('locations')
  ingest(@CurrentUser() user: AuthenticatedUser, @Body() dto: IngestLocationDto) {
    return this.tracking.ingest(user, dto);
  }

  @Get('vehicles/:vehicleId/latest')
  latest(@CurrentUser() user: AuthenticatedUser, @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string) {
    return this.tracking.latest(user, vehicleId);
  }

  @Get('vehicles/:vehicleId/trips')
  trips(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit = '50',
  ) {
    return this.tracking.getTrips(user, vehicleId, from, to, Number(limit));
  }

  @Get('vehicles/:vehicleId/trip-route')
  tripRoute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.tracking.getTripRoute(user, vehicleId, from, to);
  }

  @Get('vehicles/:vehicleId/stops')
  stops(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit = '100',
  ) {
    return this.tracking.getStops(user, vehicleId, from, to, Number(limit));
  }

  @Get('vehicles/:vehicleId/history')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit = '500',
  ) {
    return this.tracking.history(user, vehicleId, from, to, Number(limit));
  }
}
