import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from './database.constants';

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseShutdown.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
    this.logger.log('PostgreSQL pool closed');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => new Pool({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        max: config.get<number>('DB_POOL_MAX', 10),
        idleTimeoutMillis: config.get<number>('DB_IDLE_TIMEOUT_MS', 30000),
        connectionTimeoutMillis: config.get<number>('DB_CONNECTION_TIMEOUT_MS', 5000),
        application_name: 'darb-gps-api',
        // In production, enforce TLS according to the managed database provider.
        ssl: config.get<string>('NODE_ENV') === 'production'
          ? { rejectUnauthorized: true }
          : undefined,
      }),
    },
    DatabaseShutdown,
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
