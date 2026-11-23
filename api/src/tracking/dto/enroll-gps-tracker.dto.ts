import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class EnrollGpsTrackerDto {
  @IsUUID() vehicleId!: string;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
}
