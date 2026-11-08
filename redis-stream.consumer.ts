import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../outbox/outbox.constants';
import { RealtimeGateway } from './realtime.gateway';
import { REDIS_STREAM_CONSUMER } from './realtime.constants';

type StreamField = [string, string];
type StreamEntry = [string, StreamField[]];

@Injectable()
export class RedisStreamConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisStreamConsumer.name);
  private client?: Redis;
  private stopped = false;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly consumerName = `${REDIS_STREAM_CONSUMER}-${process.pid}-${randomUUID()}`;
  private groupReady = false;
  private readonly consumerGroup: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly publisherClient: Redis | null,
    private readonly config: ConfigService,
    private readonly gateway: RealtimeGateway,
  ) {
    const explicitGroup = this.config.get<string>('REALTIME_CONSUMER_GROUP');
    const instanceId = this.config.get<string>('INSTANCE_ID', 'local');
    this.consumerGroup = explicitGroup || `darb-socket-gateway-v2-${instanceId}`;
  }

  async onModuleInit(): Promise<void> {
    if (!this.publisherClient) {
      this.logger.warn('Redis is not configured; realtime stream consumer is disabled');
      return;
    }
    this.client = this.publisherClient.duplicate({
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectionName: 'darb-realtime-consumer',
    });
    this.client.on('error', (error) => this.logger.error(`Redis consumer error: ${error.message}`));
    try {
      await this.client.connect();
      const stream = this.config.get<string>('REDIS_STREAM_KEY', 'darb:events');
      await this.ensureGroup(stream);
      this.schedule(250);
      this.logger.log(`Redis Stream consumer group is ready: ${this.consumerGroup}`);
    } catch (error) {
      this.logger.error('Realtime consumer could not start', error instanceof Error ? error.stack : undefined);
      this.schedule(5000);
    }
  }


  private async ensureGroup(stream: string): Promise<void> {
    try {
      await this.client!.xgroup('CREATE', stream, this.consumerGroup, '$', 'MKSTREAM');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) throw error;
    }
    this.groupReady = true;
  }

  private schedule(delay: number): void {
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.running || !this.client) return;
    this.running = true;
    let delay = 250;
    try {
      if (this.client.status === 'end' || this.client.status === 'wait') await this.client.connect();
      if (this.client.status !== 'ready') throw new Error(`Redis status: ${this.client.status}`);
      const stream = this.config.get<string>('REDIS_STREAM_KEY', 'darb:events');
      if (!this.groupReady) await this.ensureGroup(stream);
      const claimed = await this.client.xautoclaim(
        stream, this.consumerGroup, this.consumerName, 60_000, '0-0', 'COUNT', 20,
      ) as unknown as [string, StreamEntry[], string[]];
      for (const entry of claimed?.[1] ?? []) await this.processEntry(stream, entry);
      const response = await this.client.xreadgroup(
        'GROUP', this.consumerGroup, this.consumerName,
        'COUNT', 50, 'BLOCK', 1000, 'STREAMS', stream, '>',
      ) as unknown as [string, StreamEntry[]][] | null;
      for (const [, entries] of response ?? []) {
        for (const entry of entries) await this.processEntry(stream, entry);
      }
    } catch (error) {
      delay = 3000;
      this.logger.error('Redis Stream polling failed', error instanceof Error ? error.stack : undefined);
    } finally {
      this.running = false;
      this.schedule(delay);
    }
  }

  private async processEntry(stream: string, entry: StreamEntry): Promise<void> {
    const [streamId, pairs] = entry;
    const fields = Object.fromEntries(pairs);
    try {
      const eventType = fields.eventType;
      const aggregateId = fields.aggregateId;
      const payload = JSON.parse(fields.payload ?? '{}') as Record<string, unknown>;
      if (eventType === 'vehicle.location.updated' && typeof aggregateId === 'string') {
        // At-least-once delivery: clients should deduplicate by outboxId/eventId.
        this.gateway.emitVehicleLocation(aggregateId, {
          ...payload,
          outboxId: fields.outboxId,
          streamId,
        });
      }
      await this.client!.xack(stream, this.consumerGroup, streamId);
    } catch (error) {
      // Leave malformed/unprocessable entries pending for inspection and recovery.
      this.logger.error(`Could not process Redis stream entry ${streamId}`, error instanceof Error ? error.stack : undefined);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.client && this.client.status !== 'end') await this.client.quit().catch(() => undefined);
  }
}
