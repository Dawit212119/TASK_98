import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSupportTicketDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  reservation_id!: string;

  @ApiProperty({ example: 'BILLING' })
  @IsString()
  @MaxLength(60)
  category!: string;

  @ApiProperty({ example: 'I need help with an invoice item.' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  message_id?: string;
}
