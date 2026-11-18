import {
  Controller,
  Get,
  Inject,
  private readonly logger = new Logger(HealthController.name);
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL)
    private readonly database: Pool,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'darb-gps-api',
      stage: 'deployment-foundation',
    };
  }

  @Get('ready')
  async ready() {
    try {
      await this.database.query('SELECT 1');

      return {
        status: 'ready',
        database: 'connected',
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not-ready',
        database: 'disconnected',
      });
    }
  }
}
