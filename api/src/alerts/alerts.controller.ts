import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { AlertsService } from './alerts.service';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string,
       @Query('vehicleId') vehicleId?: string, @Query('limit') limit = '100') {
    return this.alerts.list(user, status, vehicleId, Number(limit));
  }

  @Patch(':alertId/acknowledge')
  acknowledge(@CurrentUser() user: AuthenticatedUser,
              @Param('alertId', new ParseUUIDPipe()) alertId: string) {
    return this.alerts.acknowledge(user, alertId);
  }

  @Get('rules')
  rules(@CurrentUser() user: AuthenticatedUser, @Query('vehicleId') vehicleId?: string) {
    return this.alerts.rules(user, vehicleId);
  }

  @Post('rules')
  createRule(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.alerts.createRule(user, body);
  }
}