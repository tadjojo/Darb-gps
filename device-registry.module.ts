import { Module } from '@nestjs/common';
import { DeviceRegistryController } from './device-registry.controller';
import { DeviceRegistryService } from './device-registry.service';
@Module({ controllers: [DeviceRegistryController], providers: [DeviceRegistryService] })
export class DeviceRegistryModule {}
