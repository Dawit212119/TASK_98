import { IsDateString, IsEnum, IsObject, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum AnalyticsEventType {
  IMPRESSION = 'impression',
  CLICK = 'click',
  READ_COMPLETION = 'read_completion',
  CONVERSION = 'conversion',
  SHARE = 'share'
}

export class IngestEventDto {
  @ApiProperty({ enum: AnalyticsEventType, example: AnalyticsEventType.IMPRESSION })
  @IsEnum(AnalyticsEventType)
  event_type!: AnalyticsEventType;

  @ApiProperty({ example: 'article' })
  @IsString()
  @MaxLength(80)
  subject_type!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  subject_id!: string;

  @ApiProperty({ example: '2026-01-01T12:00:00.000Z' })
  @IsDateString()
  occurred_at!: string;

  @ApiProperty({ type: Object, example: { source: 'web' } })
  @IsObject()
  metadata!: Record<string, unknown>;
}
