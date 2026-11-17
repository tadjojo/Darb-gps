import {
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';

export class AddVehicleMemberDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['owner', 'manager', 'driver', 'viewer'])
  role!: string;
}
