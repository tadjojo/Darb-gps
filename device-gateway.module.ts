import { Module } from '@nestjs/common';
import { DeviceGatewayController } from './device-gateway.controller';
import { DeviceGatewayService } from './device-gateway.service';
import { Nmea0183Adapter } from './adapters/nmea0183.adapter';
import { Gt06Adapter } from './adapters/gt06.adapter';
import { JsonTrackerAdapter } from './adapters/json.adapter';
import { TrackerTcpServer } from './tracker-tcp.server';

@Module({ controllers: [DeviceGatewayController], providers: [DeviceGatewayService, Nmea0183Adapter, Gt06Adapter, JsonTrackerAdapter, TrackerTcpServer] })
export class DeviceGatewayModule {}
