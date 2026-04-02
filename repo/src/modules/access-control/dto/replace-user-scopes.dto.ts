import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReplaceUserScopesDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Data scope IDs to assign to the user (replaces all current assignments)' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  scope_ids!: string[];
}
