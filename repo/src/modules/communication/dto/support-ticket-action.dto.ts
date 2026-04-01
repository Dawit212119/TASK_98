import { IsBooleanString, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class EscalateSupportTicketDto {
  @ApiPropertyOptional({ example: 'Need immediate review' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ResolveSupportTicketDto {
  @ApiPropertyOptional({ example: 'Issue resolved by support team' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolution_note?: string;
}

export class CloseSupportTicketDto {
  @ApiPropertyOptional({ example: 'Ticket archived after follow-up' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  close_note?: string;
}

export class CreateSensitiveWordDto {
  @IsString()
  @MaxLength(80)
  word!: string;
}

export class UpdateSensitiveWordDto {
  @IsString()
  @MaxLength(80)
  word!: string;
}

export class ToggleSensitiveWordDto {
  @IsBooleanString()
  active!: string;
}

export class SensitiveWordListQueryDto {
  @IsOptional()
  @IsBooleanString()
  active?: string;
}
