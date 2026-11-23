import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { TrackingModule } from './tracking/tracking.module';
import { DeviceGatewayModule } from './device-gateway/device-gateway.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    OrganizationsModule,
    TrackingModule,
    DeviceGatewayModule,
  ],
})
export class AppModule {}
