import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { PG_POOL } from '../database/database.constants';
import { REDIS_CLIENT } from './outbox.constants';

type OutboxRow = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
};

@Injectable()
export class OutboxWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly workerId = randomUUID();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private running = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.redis) {
      this.logger.warn('REDIS_URL is not configured; outbox events will remain pending');
      return;
    }
    try {
      await this.redis.connect();
      this.schedule(1000);
      this.logger.log('Outbox publisher connected to Redis Streams');
    } catch (error) {
      this.logger.error('Redis connection failed; outbox publisher remains idle', error instanceof Error ? error.stack : undefined);
      // Do not mark events published. Retry connection on the next poll cycle.
      this.schedule(5000);
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running || !this.redis) return;
    this.running = true;
    let nextDelay = 1000;
    try {
      if (this.redis.status !== 'ready') {
        if (this.redis.status === 'end') await this.redis.connect();
        else if (this.redis.status === 'wait') await this.redis.connect();
        if (this.redis.status !== 'ready') throw new Error(`Redis is not ready (${this.redis.status})`);
      }
      const rows = await this.claimBatch();
      for (const row of rows) await this.publishOne(row);
    } catch (error) {
      nextDelay = 5000;
      this.logger.error('Outbox polling cycle failed', error instanceof Error ? error.stack : undefined);
    } finally {
      this.running = false;
      this.schedule(nextDelay);
    }
  }

  private async claimBatch(): Promise<OutboxRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<OutboxRow>(
        `SELECT id, event_type, aggregate_id, payload, attempts
           FROM event_outbox
          WHERE (status = 'pending' AND available_at <= now())
             OR (status = 'processing' AND lease_until < now())
          ORDER BY id
          LIMIT 25
          FOR UPDATE SKIP LOCKED`,
      );
      if (!selected.rowCount) {
        await client.query('COMMIT');
        return [];
      }
      const ids = selected.rows.map((row: OutboxRow) => row.id);
      const claimed = await client.query<OutboxRow>(
        `UPDATE event_outbox
            SET status = 'processing', attempts = attempts + 1,
                lease_owner = $1, lease_until = now() + interval '120 seconds'
          WHERE id = ANY($2::bigint[])
          RETURNING id, event_type, aggregate_id, payload, attempts`,
        [this.workerId, ids],
      );
      await client.query('COMMIT');
      return claimed.rows;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async publishOne(row: OutboxRow): Promise<void> {
    try {
      await this.redis!.xadd(
        this.config.get<string>('REDIS_STREAM_KEY', 'darb:events'),
        '*',
        'outboxId', row.id,
        'eventType', row.event_type,
        'aggregateId', row.aggregate_id,
        'payload', JSON.stringify(row.payload),
      );
      const result = await this.pool.query(
        `UPDATE event_outbox
            SET status = 'published', published_at = now(), lease_owner = NULL, lease_until = NULL
          WHERE id = $1 AND status = 'processing' AND lease_owner = $2`,
        [row.id, this.workerId],
      );
      if (!result.rowCount) this.logger.warn(`Outbox lease lost after publishing event ${row.id}; downstream deduplication is required`);
    } catch (error) {
      const delaySeconds = Math.min(3600, 2 ** Math.min(row.attempts, 11));
      await this.pool.query(
        `UPDATE event_outbox
            SET status = CASE WHEN attempts >= 10 THEN 'failed' ELSE 'pending' END,
                available_at = now() + ($3 * interval '1 second'),
                lease_owner = NULL, lease_until = NULL
          WHERE id = $1 AND status = 'processing' AND lease_owner = $2`,
        [row.id, this.workerId, delaySeconds],
      );
      this.logger.error(`Failed to publish outbox event ${row.id}; retry delay ${delaySeconds}s`, error instanceof Error ? error.stack : undefined);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.redis && this.redis.status !== 'end') await this.redis.quit().catch(() => undefined);
  }
}
