import { Module } from '@nestjs/common';
import { TrackingModule } from '../tracking/tracking.module';
import { DeviceGatewayController } from './device-gateway.controller';

@Module({
  imports: [TrackingModule],
  controllers: [DeviceGatewayController],
})
export class DeviceGatewayModule {}
