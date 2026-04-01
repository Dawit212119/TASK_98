import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ example: 'custom_operator' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name!: string;

  @ApiPropertyOptional({ example: 'Custom role for integration operators' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  permission_ids!: string[];
}
