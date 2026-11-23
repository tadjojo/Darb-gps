import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TrackerLocationDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(500) speedKmh?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(360) heading?: number;
  @IsDateString() recordedAt!: string;
}
