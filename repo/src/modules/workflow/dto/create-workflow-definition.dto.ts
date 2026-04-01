import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';
import { WorkflowApprovalMode } from '../entities/workflow-definition.entity';

class WorkflowStepInputDto {
  @IsInt()
  @Min(1)
  order!: number;

  @IsString()
  @MaxLength(64)
  approver_role!: string;

  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;
}

export class CreateWorkflowDefinitionDto {
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsEnum(WorkflowApprovalMode)
  approval_mode!: WorkflowApprovalMode;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepInputDto)
  steps!: WorkflowStepInputDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(336)
  sla_hours?: number;
}
