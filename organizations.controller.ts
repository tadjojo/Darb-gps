import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { AddVehicleMemberDto } from './dto/add-vehicle-member.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post('organizations')
  createOrganization(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrganizationDto) {
    return this.organizations.createOrganization(user, dto);
  }

  @Post('organizations/:organizationId/vehicles')
  createVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() dto: CreateVehicleDto,
  ) { return this.organizations.createVehicle(user, organizationId, dto); }

  @Get('organizations/:organizationId/vehicles')
  listVehicles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) { return this.organizations.listVehicles(user, organizationId); }

  @Post('vehicles/:vehicleId/members')
  addVehicleMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string,
    @Body() dto: AddVehicleMemberDto,
  ) { return this.organizations.addVehicleMember(user, vehicleId, dto); }
  @Delete('vehicles/:vehicleId/members/:memberUserId')
  revokeVehicleMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', new ParseUUIDPipe()) vehicleId: string,
    @Param('memberUserId', new ParseUUIDPipe()) memberUserId: string,
  ) { return this.organizations.revokeVehicleMember(user, vehicleId, memberUserId); }

}
