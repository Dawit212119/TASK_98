import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelReservationDto {
  @ApiProperty({ example: 'Patient unavailable' })
  @IsString()
  @MaxLength(255)
  reason!: string;
}
