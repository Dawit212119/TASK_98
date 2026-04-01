import { IsEnum, IsString, MaxLength } from 'class-validator';

export enum AppealOutcome {
  UPHOLD = 'UPHOLD',
  MODIFY = 'MODIFY',
  REMOVE = 'REMOVE'
}

export class ArbitrateAppealDto {
  @IsEnum(AppealOutcome)
  outcome!: AppealOutcome;

  @IsString()
  @MaxLength(2000)
  notes!: string;
}
