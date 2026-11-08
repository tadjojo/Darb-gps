import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../outbox/outbox.constants';
import { PG_POOL } from '../database/database.constants';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  @Get('live')
  live() {
    return { status: 'ok', service: 'darb-gps-api' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.pool.query('SELECT 1');
      if (this.redis) await this.redis.ping();
      return { status: 'ready', database: 'connected', realtime: this.redis ? 'connected' : 'disabled' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready', dependency: 'database_or_redis' });
    }
  }
}
