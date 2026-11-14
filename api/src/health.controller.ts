import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'darb-gps-api',
      stage: 'deployment-foundation',
    };
  }

  @Get('ready')
  ready() {
    return {
      status: 'ready',
      database: 'not-configured',
    };
  }
}
