import { IsIn, IsOptional, IsString } from 'class-validator';

export class SortQueryDto {
  @IsOptional()
  @IsString()
  sort_by?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
