import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class EnrollGpsTrackerDto {
  @IsUUID() vehicleId!: string;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsOptional() @IsIn(['json', 'gt06', 'nmea']) protocol?: 'json' | 'gt06' | 'nmea';
  @IsOptional() @IsString() @Matches(/^[0-9]{8,20}$/) imei?: string;
  @IsOptional() @IsString() @MaxLength(80) model?: string;
  @IsOptional() @IsInt() @Min(-840) @Max(840) timezoneOffsetMinutes?: number;
}
