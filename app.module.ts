import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { TrackingModule } from './tracking/tracking.module';
import { OutboxModule } from './outbox/outbox.module';
import { RealtimeModule } from './realtime/realtime.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { DeviceGatewayModule } from './device-gateway/device-gateway.module';
import { DeviceRegistryModule } from './device-registry/device-registry.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: environmentSchema }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    TrackingModule,
    OutboxModule,
    RealtimeModule,
    OrganizationsModule,
    DeviceGatewayModule,
    DeviceRegistryModule,
  ],
})
export class AppModule {}
