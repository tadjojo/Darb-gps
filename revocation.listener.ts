import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { RealtimeGateway } from './realtime.gateway';

@Injectable()
export class RevocationListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RevocationListener.name);
  private client?: PoolClient;
  private retryTimer?: NodeJS.Timeout;
  private stopping = false;
  private retryDelayMs = 1_000;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly gateway: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    void this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const client = this.client;
    this.client = undefined;
    if (client) {
      try { await client.query('UNLISTEN *'); } catch { /* connection may already be gone */ }
      client.release();
    }
  }

  private async connect(): Promise<void> {
    if (this.stopping || this.client) return;
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query('LISTEN darb_access_revoked');
      await client.query('LISTEN darb_vehicle_member_revoked');
      this.client = client;
      this.retryDelayMs = 1_000;
      client.on('notification', (message: { channel?: string; payload?: string }) => this.handleNotification(message));
      client.on('error', (error: Error) => {
        this.logger.error('PostgreSQL revocation listener connection failed', error.stack);
        this.dropClient(client!);
      });
      client.on('end', () => this.dropClient(client!));
      this.logger.log('Listening for distributed authorization revocations');
    } catch (error) {
      if (client) client.release(true);
      this.logger.error('Unable to start revocation listener; retry scheduled', error instanceof Error ? error.stack : undefined);
      this.scheduleReconnect();
    }
  }

  private handleNotification(message: { channel?: string; payload?: string }): void {
    if (!message.payload) return;
    try {
      const payload = JSON.parse(message.payload) as Record<string, unknown>;
      if (message.channel === 'darb_access_revoked' && typeof payload.jti === 'string') {
        this.gateway.revokeAccessToken(payload.jti);
      } else if (
        message.channel === 'darb_vehicle_member_revoked' &&
        typeof payload.userId === 'string' && typeof payload.vehicleId === 'string'
      ) {
        this.gateway.revokeVehicleMembership(payload.userId, payload.vehicleId);
      }
    } catch (error) {
      this.logger.warn(`Ignored malformed revocation notification: ${error instanceof Error ? error.message : 'invalid payload'}`);
    }
  }

  private dropClient(client: PoolClient): void {
    if (this.client !== client) return;
    this.client = undefined;
    try { client.release(true); } catch { /* already released by pg */ }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.retryTimer) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, delay);
    this.retryTimer.unref?.();
  }
}
