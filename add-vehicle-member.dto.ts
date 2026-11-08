import { IsIn, IsUUID } from 'class-validator';
export class AddVehicleMemberDto {
  @IsUUID() userId!: string;
  @IsIn(['manager', 'driver', 'viewer']) role!: 'manager' | 'driver' | 'viewer';
}
