import { IsOptional, IsString, MaxLength, Matches, IsDateString } from 'class-validator';

export class NmeaIngestDto {
  @IsString()
  @MaxLength(256)
  @Matches(/^\$[^*]+\*[0-9A-Fa-f]{2}$/)
  sentence!: string;

  @IsOptional()
  @IsDateString()
  pairedUtcTimestamp?: string;
}
