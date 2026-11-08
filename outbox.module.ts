import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PG_POOL } from '../database/database.constants';
import { REDIS_CLIENT } from './outbox.constants';
import { OutboxWorker } from './outbox.worker';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const url = config.get<string>('REDIS_URL');
        if (!url) return null;
        return new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableReadyCheck: true,
          connectionName: 'darb-outbox-publisher',
        });
      },
    },
    OutboxWorker,
  ],
  exports: [REDIS_CLIENT],
})
export class OutboxModule {}
