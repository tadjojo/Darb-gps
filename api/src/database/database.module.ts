
import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

export const DATABASE_POOL = 'DATABASE_POOL';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;

        if (!connectionString) {
          throw new Error('DATABASE_URL is not configured');
        }

        return new Pool({
          connectionString,
          ssl: { rejectUnauthorized: false },
          max: 10,
          connectionTimeoutMillis: 10000,
        });
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
