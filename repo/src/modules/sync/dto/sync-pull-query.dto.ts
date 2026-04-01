import { Transform, Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SyncEntityType } from './sync-push.dto';

export class SyncPullQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  since_updated_at?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  since_version?: number;

  @ApiPropertyOptional({ type: [String], example: ['reservation', 'notification'] })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const rawValue = value ?? obj?.['entity_types[]'];

    if (Array.isArray(rawValue)) {
      return rawValue.flatMap((item) => String(item).split(',').map((token) => token.trim())).filter(Boolean);
    }
    if (typeof rawValue === 'string') {
      return rawValue
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
    }

    return rawValue;
  })
  @IsArray()
  @IsString({ each: true })
  entity_types?: SyncEntityType[];
}
