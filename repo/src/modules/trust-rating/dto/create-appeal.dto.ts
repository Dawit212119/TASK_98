import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAppealDto {
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  evidence_files?: string[];
}
