import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RedisStreamConsumer } from './redis-stream.consumer';
import { RevocationListener } from './revocation.listener';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RedisStreamConsumer, RevocationListener],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
