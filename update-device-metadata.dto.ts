import { IsInt, IsOptional, IsString, MaxLength, Matches, Min, Max } from 'class-validator';
export class UpdateDeviceMetadataDto {
  @IsOptional() @IsString() @MaxLength(100) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(100) modelName?: string;
  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[0-9]{14,17}$/) imei?: string;
  @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(80) firmwareVersion?: string;
  @IsOptional() @IsString() @MaxLength(80) hardwareVersion?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) batteryPercent?: number;
  @IsOptional() @IsInt() @Min(-160) @Max(0) signalStrengthDbm?: number;
  @IsOptional() @IsString() @MaxLength(30) networkType?: string;
}
