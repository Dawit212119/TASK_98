import { IsDateString, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RescheduleReservationDto {
  @ApiProperty({ example: '2026-04-11T10:00:00.000Z' })
  @IsDateString()
  new_start_time!: string;

  @ApiProperty({ example: '2026-04-11T11:00:00.000Z' })
  @IsDateString()
  new_end_time!: string;

  @ApiProperty({ example: 'Provider unavailable on original slot' })
  @IsString()
  @MaxLength(255)
  reason!: string;
}
