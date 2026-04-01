import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApproveWorkflowRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  comment?: string;
}

export class RejectWorkflowRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(512)
  reason!: string;
}
