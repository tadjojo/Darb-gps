import { IsString, MaxLength, MinLength, Matches } from 'class-validator';

export class Gt06IngestDto {
  @IsString()
  @MinLength(20)
  @MaxLength(520)
  @Matches(/^(?:[0-9A-Fa-f]{2})+$/)
  frameHex!: string;
}
