import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RetentionQueryDto {
  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  cohort_start!: string;

  @ApiProperty({ example: '2026-01-31T23:59:59.999Z' })
  @IsDateString()
  cohort_end!: string;

  @ApiPropertyOptional({ example: 'weekly' })
  @IsOptional()
  @IsString()
  bucket?: string;
}
