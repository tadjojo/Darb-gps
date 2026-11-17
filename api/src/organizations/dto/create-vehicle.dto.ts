import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  registrationNumber?: string;
}
