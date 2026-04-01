import { IsArray, IsIn, IsObject, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const ANALYTICS_CSV_REPORT_TYPES = ['funnel', 'retention', 'content_quality'] as const;
export type AnalyticsCsvReportType = (typeof ANALYTICS_CSV_REPORT_TYPES)[number];

export class CreateCsvExportDto {
  @ApiProperty({ enum: ANALYTICS_CSV_REPORT_TYPES, example: 'retention' })
  @IsString()
  @MaxLength(80)
  @IsIn(ANALYTICS_CSV_REPORT_TYPES)
  report_type!: AnalyticsCsvReportType;

  @ApiProperty({ type: Object, example: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T23:59:59.999Z' } })
  @IsObject()
  filters!: Record<string, unknown>;

  @ApiProperty({ type: [String], example: ['stage', 'count'] })
  @IsArray()
  @IsString({ each: true })
  columns!: string[];
}
