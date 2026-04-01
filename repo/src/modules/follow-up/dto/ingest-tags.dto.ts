import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class IngestTagItemDto {
  @ApiProperty({ example: 'risk' })
  @IsString()
  @MaxLength(100)
  key!: string;

  @ApiProperty({ example: 'low' })
  @IsString()
  @MaxLength(120)
  value!: string;

  @ApiProperty({ example: 'provider' })
  @IsString()
  @MaxLength(100)
  source!: string;
}

export class IngestTagsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  reservation_id!: string;

  @ApiProperty({ type: [IngestTagItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IngestTagItemDto)
  tags!: IngestTagItemDto[];
}
