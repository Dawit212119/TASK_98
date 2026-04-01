import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReservationDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  patient_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  provider_id?: string;

  @ApiProperty({ example: '2026-04-10T10:00:00.000Z' })
  @IsDateString()
  start_time!: string;

  @ApiProperty({ example: '2026-04-10T11:00:00.000Z' })
  @IsDateString()
  end_time!: string;

  @ApiPropertyOptional({ example: 'Patient requested morning slot' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
