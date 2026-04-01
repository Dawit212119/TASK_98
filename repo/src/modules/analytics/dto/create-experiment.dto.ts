import { IsArray, IsBoolean, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExperimentDto {
  @ApiProperty({ example: 'Homepage CTA experiment' })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ type: [String], example: ['control', 'variant_a'] })
  @IsArray()
  @IsString({ each: true })
  variants!: string[];

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  start_at?: string;

  @ApiPropertyOptional({ example: '2026-01-31T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  end_at?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  active!: boolean;
}
