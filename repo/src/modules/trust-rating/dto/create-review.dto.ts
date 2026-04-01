import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class ReviewDimensionDto {
  @IsString()
  @MaxLength(50)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;
}

export class CreateReviewDto {
  @IsUUID()
  target_user_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReviewDimensionDto)
  dimensions!: ReviewDimensionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
