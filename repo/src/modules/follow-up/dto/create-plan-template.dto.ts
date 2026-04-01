import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class TriggerTagDto {
  @ApiProperty({ example: 'risk' })
  @IsString()
  @MaxLength(100)
  key!: string;

  @ApiPropertyOptional({ example: 'high' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  value?: string;
}

class TaskRuleDto {
  @ApiProperty({ example: 'check-in' })
  @IsString()
  @MaxLength(150)
  task_name!: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  every_n_days?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  every_n_months?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  occurrences?: number;
}

export class CreatePlanTemplateDto {
  @ApiProperty({ example: 'Diabetes Monitoring Template' })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ type: [TriggerTagDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TriggerTagDto)
  trigger_tags!: TriggerTagDto[];

  @ApiProperty({ type: [TaskRuleDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaskRuleDto)
  task_rules!: TaskRuleDto[];

  @ApiProperty({ example: true })
  @IsBoolean()
  active!: boolean;
}
