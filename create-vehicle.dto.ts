import { IsOptional, IsString, Length, Matches } from 'class-validator';
export class CreateVehicleDto {
  @IsString() @Length(2, 100) displayName!: string;
  @IsOptional() @IsString() @Length(1, 40) @Matches(/^[\p{L}\p{N} ._-]+$/u) registrationNumber?: string;
}
