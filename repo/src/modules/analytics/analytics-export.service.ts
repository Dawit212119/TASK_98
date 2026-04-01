import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { AccessControlService } from '../access-control/access-control.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../../common/exceptions/app.exception';
import { AnalyticsExportEntity } from './entities/analytics-export.entity';
import { CreateCsvExportDto, ANALYTICS_CSV_REPORT_TYPES } from './dto/create-csv-export.dto';
import { AnalyticsEventService } from './analytics-event.service';

@Injectable()
export class AnalyticsExportService {
  constructor(
    private readonly configService: ConfigService,
    private readonly accessControlService: AccessControlService,
    private readonly auditService: AuditService,
    private readonly eventService: AnalyticsEventService,
    @InjectRepository(AnalyticsExportEntity)
    private readonly exportRepository: Repository<AnalyticsExportEntity>
  ) {}

  async createCsvExport(userId: string, payload: CreateCsvExportDto): Promise<Record<string, unknown>> {
    await this.requireAnalyticsRead(userId);

    const exportRecord = await this.exportRepository.save(
      this.exportRepository.create({
        requestedBy: userId,
        reportType: payload.report_type,
        filters: payload.filters,
        columns: payload.columns,
        status: 'READY',
        filePath: null,
        fileSizeBytes: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })
    );

    const exportDir = join(this.getExportDir(), 'analytics');
    await mkdir(exportDir, { recursive: true });

    const csvName = `${exportRecord.id}-${randomUUID()}.csv`;
    const fullPath = join(exportDir, csvName);
    const csvBody = await this.buildCsv(userId, payload.report_type, payload.filters, payload.columns);
    await writeFile(fullPath, csvBody);

    const fileStats = await stat(fullPath);
    exportRecord.filePath = fullPath;
    exportRecord.fileSizeBytes = Number(fileStats.size);
    exportRecord.status = 'READY';
    await this.exportRepository.save(exportRecord);

    await this.auditService.appendLog({
      entityType: 'analytics_export',
      entityId: exportRecord.id,
      action: 'analytics.export.create',
      actorId: userId,
      payload: {
        report_type: payload.report_type,
        columns_count: payload.columns.length
      }
    });

    return {
      export_id: exportRecord.id,
      status: exportRecord.status
    };
  }

  async getCsvExport(userId: string, exportId: string): Promise<Record<string, unknown>> {
    await this.requireAnalyticsRead(userId);

    const exportRecord = await this.exportRepository.findOne({ where: { id: exportId, deletedAt: IsNull() } });
    if (!exportRecord) {
      throw new AppException('NOT_FOUND', 'Export not found', { export_id: exportId }, 404);
    }

    if (this.isAnalyticsExportExpired(exportRecord)) {
      throw new AppException('ANALYTICS_EXPORT_EXPIRED', 'Export has expired', { export_id: exportId }, 410);
    }

    await this.assertCanAccessAnalyticsExport(userId, exportRecord);

    await this.auditService.appendLog({
      entityType: 'analytics_export',
      entityId: exportRecord.id,
      action: 'analytics.export.metadata.read',
      actorId: userId,
      payload: {
        resource_owner_id: exportRecord.requestedBy,
        access: exportRecord.requestedBy === userId ? 'owner' : 'ops_admin'
      }
    });

    return {
      export_id: exportRecord.id,
      status: exportRecord.status,
      file_id: exportRecord.id,
      file_name: exportRecord.filePath ? exportRecord.filePath.split(/[\\/]/).pop() : null,
      file_size_bytes: exportRecord.fileSizeBytes,
      created_at: exportRecord.createdAt.toISOString(),
      expires_at: exportRecord.expiresAt?.toISOString() ?? null,
      download_path: exportRecord.filePath ? `/api/v1/analytics/exports/${exportRecord.id}/download` : null
    };
  }

  async prepareExportDownload(userId: string, exportId: string): Promise<{ stream: ReadStream; filename: string; mimeType: string }> {
    await this.requireAnalyticsRead(userId);

    const exportRecord = await this.exportRepository.findOne({ where: { id: exportId, deletedAt: IsNull() } });
    if (!exportRecord) {
      throw new AppException('NOT_FOUND', 'Export not found', { export_id: exportId }, 404);
    }

    if (this.isAnalyticsExportExpired(exportRecord)) {
      throw new AppException('ANALYTICS_EXPORT_EXPIRED', 'Export has expired', { export_id: exportId }, 410);
    }

    await this.assertCanAccessAnalyticsExport(userId, exportRecord);

    if (!exportRecord.filePath) {
      throw new AppException('NOT_FOUND', 'Export file not available', { export_id: exportId }, 404);
    }

    await this.auditService.appendLog({
      entityType: 'analytics_export',
      entityId: exportRecord.id,
      action: 'analytics.export.download',
      actorId: userId,
      payload: {
        resource_owner_id: exportRecord.requestedBy,
        access: exportRecord.requestedBy === userId ? 'owner' : 'ops_admin'
      }
    });

    const filename = exportRecord.filePath.split(/[/\\]/).pop() ?? `${exportId}.csv`;
    return {
      stream: createReadStream(exportRecord.filePath),
      filename,
      mimeType: 'text/csv; charset=utf-8'
    };
  }

  private async buildCsv(userId: string, reportType: string, filters: Record<string, unknown>, columns: string[]): Promise<string> {
    if (reportType === 'funnel') {
      const from = String(filters.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      const to = String(filters.to ?? new Date().toISOString());
      const funnel = await this.eventService.getFunnelAggregation('system', { from, to, subject_type: filters.subject_type as string | undefined });

      const headers = columns.length > 0 ? columns : ['stage', 'count'];
      const rows = (funnel.stages as Array<{ stage: string; count: number }>).map((stage) => [stage.stage, String(stage.count)]);
      return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    }

    if (reportType === 'content_quality') {
      const from = String(filters.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      const to = String(filters.to ?? new Date().toISOString());
      const cq = await this.eventService.getContentQualityAggregation('system', {
        from,
        to,
        subject_type: filters.subject_type as string | undefined
      });

      const rows: string[][] = [
        ['impression_count', String(cq.impression_count)],
        ['completion_count', String((cq.completion_metric as { completion_count: number }).completion_count)],
        ['completion_rate_percent', String((cq.completion_metric as { completion_rate_percent: number }).completion_rate_percent)],
        ['engagement_count', String((cq.engagement_metric as { engagement_count: number }).engagement_count)],
        ['engagement_rate_percent', String((cq.engagement_metric as { engagement_rate_percent: number }).engagement_rate_percent)],
        ['share_count', String((cq.share_metric as { share_count: number }).share_count)],
        ['share_rate_percent', String((cq.share_metric as { share_rate_percent: number }).share_rate_percent)]
      ];
      const headers = columns.length > 0 ? columns : ['metric', 'value'];
      return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    }

    if (reportType === 'retention') {
      const cohort_start = String(filters.cohort_start ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      const cohort_end = String(filters.cohort_end ?? new Date().toISOString());
      const bucket = filters.bucket ? String(filters.bucket) : undefined;
      const retention = await this.eventService.getRetentionAggregation('system', { cohort_start, cohort_end, bucket });

      const headers = columns.length > 0 ? columns : [
        'cohort_start',
        'cohort_end',
        'bucket',
        'cohort_size',
        'retained_size',
        'retention_rate_percent'
      ];

      const row = [
        String(retention.cohort_start),
        String(retention.cohort_end),
        String(retention.bucket),
        String(retention.cohort_size),
        String(retention.retained_size),
        String(retention.retention_rate_percent)
      ];

      return [headers.join(','), row.join(',')].join('\n');
    }

    throw new AppException(
      'ANALYTICS_REPORT_TYPE_NOT_SUPPORTED',
      `Unsupported report_type. Supported values: ${ANALYTICS_CSV_REPORT_TYPES.join(', ')}`,
      { report_type: reportType },
      422
    );
  }

  private async requireAnalyticsRead(userId: string): Promise<void> {
    if (userId === 'system') {
      return;
    }
    const permissions = await this.accessControlService.getUserPermissions(userId);
    if (permissions.includes('analytics.api.use')) {
      return;
    }
    const roles = await this.accessControlService.getUserRoleNames(userId);
    if (roles.includes('ops_admin') || roles.includes('analytics_viewer')) {
      return;
    }
    throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
  }

  private isAnalyticsExportExpired(record: AnalyticsExportEntity): boolean {
    return Boolean(record.expiresAt && record.expiresAt.getTime() < Date.now());
  }

  private async assertCanAccessAnalyticsExport(actorId: string, record: AnalyticsExportEntity): Promise<void> {
    if (record.requestedBy === actorId) {
      return;
    }
    const roles = await this.accessControlService.getUserRoleNames(actorId);
    if (roles.includes('ops_admin')) {
      return;
    }
    throw new AppException(
      'FORBIDDEN',
      'Cannot access another user\'s analytics export',
      { export_id: record.id },
      403
    );
  }

  private getExportDir(): string {
    return this.configService.get<string>('UPLOAD_DIR') ?? '/uploads';
  }
}
