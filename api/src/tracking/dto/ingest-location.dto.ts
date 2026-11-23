import { IsDateString, IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class IngestLocationDto {
  @IsUUID() vehicleId!: string;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(500) speedKmh?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(360) heading?: number;
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsUUID() deviceId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(250) accuracyMeters?: number;
  @IsOptional() @IsIn(['mobile']) source?: string;
  @IsDateString() recordedAt!: string;
}
