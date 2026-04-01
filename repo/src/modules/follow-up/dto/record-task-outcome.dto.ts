import { IsEnum, IsNumber, IsObject, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum FollowUpOutcomeStatus {
  DONE = 'DONE',
  MISSED = 'MISSED',
  DEFERRED = 'DEFERRED'
}

export class RecordTaskOutcomeDto {
  @ApiProperty({ enum: FollowUpOutcomeStatus, example: FollowUpOutcomeStatus.DONE })
  @IsEnum(FollowUpOutcomeStatus)
  status!: FollowUpOutcomeStatus;

  @ApiProperty({ type: Object, example: { note: 'Patient completed task' } })
  @IsObject()
  outcome_payload!: Record<string, unknown>;

  @ApiProperty({ example: 92 })
  @IsNumber()
  @Min(0)
  @Max(100)
  adherence_score!: number;
}
