import { IsObject, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateWorkflowRequestDto {
  @IsUUID()
  workflow_definition_id!: string;

  @IsString()
  @MaxLength(80)
  resource_type!: string;

  @IsString()
  @MaxLength(150)
  resource_ref!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
