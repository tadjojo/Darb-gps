import { IsString, Length } from 'class-validator';
export class CreateOrganizationDto {
  @IsString() @Length(2, 160) name!: string;
}
