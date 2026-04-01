import { Injectable } from '@nestjs/common';
import { AnalyticsEventService } from './analytics-event.service';
import { AnalyticsExperimentService } from './analytics-experiment.service';
import { AnalyticsExportService } from './analytics-export.service';
import { CreateCsvExportDto } from './dto/create-csv-export.dto';
import { CreateExperimentDto } from './dto/create-experiment.dto';
import { FunnelQueryDto } from './dto/funnel-query.dto';
import { IngestEventDto } from './dto/ingest-event.dto';
import { RetentionQueryDto } from './dto/retention-query.dto';
import type { ReadStream } from 'node:fs';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly eventService: AnalyticsEventService,
    private readonly experimentService: AnalyticsExperimentService,
    private readonly exportService: AnalyticsExportService
  ) {}

  async ingestEvent(userId: string, payload: IngestEventDto): Promise<Record<string, unknown>> {
    return this.eventService.ingestEvent(userId, payload);
  }

  async getFunnelAggregation(userId: string, query: FunnelQueryDto): Promise<Record<string, unknown>> {
    return this.eventService.getFunnelAggregation(userId, query);
  }

  async getRetentionAggregation(userId: string, query: RetentionQueryDto): Promise<Record<string, unknown>> {
    return this.eventService.getRetentionAggregation(userId, query);
  }

  async getContentQualityAggregation(userId: string, query: FunnelQueryDto): Promise<Record<string, unknown>> {
    return this.eventService.getContentQualityAggregation(userId, query);
  }

  async createExperiment(userId: string, payload: CreateExperimentDto): Promise<Record<string, unknown>> {
    return this.experimentService.createExperiment(userId, payload);
  }

  async getDeterministicAssignment(userId: string, experimentId: string, targetUserId: string): Promise<Record<string, unknown>> {
    return this.experimentService.getDeterministicAssignment(userId, experimentId, targetUserId);
  }

  async createCsvExport(userId: string, payload: CreateCsvExportDto): Promise<Record<string, unknown>> {
    return this.exportService.createCsvExport(userId, payload);
  }

  async getCsvExport(userId: string, exportId: string): Promise<Record<string, unknown>> {
    return this.exportService.getCsvExport(userId, exportId);
  }

  async prepareExportDownload(userId: string, exportId: string): Promise<{ stream: ReadStream; filename: string; mimeType: string }> {
    return this.exportService.prepareExportDownload(userId, exportId);
  }
}
