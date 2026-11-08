import { IsDateString, IsIn, IsLatitude, IsLongitude, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class MobileLocationDto {
  @IsUUID() eventId!: string;
  @IsUUID() deviceId!: string;
  @IsUUID() vehicleId!: string;
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(250) speedKmh?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(360) heading?: number;
  @IsNumber() @Min(0) @Max(1000) accuracyMeters!: number;
  @IsDateString() recordedAt!: string;
  @IsOptional() @IsIn(['mobile']) source?: 'mobile';
}

export class EnrollMobileDeviceDto {
  @IsUUID() vehicleId!: string;
}
