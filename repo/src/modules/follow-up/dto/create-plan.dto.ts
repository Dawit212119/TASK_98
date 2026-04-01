import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  patient_id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  template_id!: string;

  @ApiProperty({ example: '2026-05-02' })
  @IsDateString()
  start_date!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  reservation_id?: string;
}
