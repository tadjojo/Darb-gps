import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { DeviceRegistryService } from './device-registry.service';
import { UpdateDeviceMetadataDto } from './dto/update-device-metadata.dto';

@Controller('tracking/devices')
@UseGuards(JwtAuthGuard)
export class DeviceRegistryController {
  constructor(private readonly registry: DeviceRegistryService) {}
  @Get('vehicle/:vehicleId')
  list(@CurrentUser() user: AuthenticatedUser, @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string) {
    return this.registry.listForVehicle(user, vehicleId);
  }
  @Patch(':deviceId/metadata')
  update(@CurrentUser() user: AuthenticatedUser, @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
    @Body() dto: UpdateDeviceMetadataDto) {
    return this.registry.updateMetadata(user, deviceId, dto);
  }
}
