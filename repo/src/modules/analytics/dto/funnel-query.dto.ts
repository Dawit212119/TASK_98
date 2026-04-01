import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FunnelQueryDto {
  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-01-31T23:59:59.999Z' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ example: 'article' })
  @IsOptional()
  @IsString()
  subject_type?: string;
}
