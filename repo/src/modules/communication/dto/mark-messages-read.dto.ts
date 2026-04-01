import { IsDateString, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class MarkMessagesReadDto {
  @IsOptional()
  @IsUUID()
  last_read_message_id?: string;

  @IsOptional()
  @IsDateString()
  last_read_at?: string;

  @ValidateIf((dto: MarkMessagesReadDto) => !dto.last_read_message_id && !dto.last_read_at)
  _atLeastOne?: string;
}
