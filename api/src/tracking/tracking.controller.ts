import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { IngestLocationDto } from './dto/ingest-location.dto';
import { TrackingService } from './tracking.service';

@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('locations')
  ingest(@CurrentUser() user: AuthenticatedUser, @Body() dto: IngestLocationDto) {
    return this.tracking.ingest(user, dto);
  }

  @Get('vehicles/:vehicleId/latest')
  latest(@CurrentUser() user: AuthenticatedUser, @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string) {
    return this.tracking.latest(user, vehicleId);
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
