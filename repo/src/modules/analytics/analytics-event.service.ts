import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../access-control/access-control.service';
import { AuditService } from '../audit/audit.service';
import { AnalyticsEventEntity } from './entities/analytics-event.entity';
import { IngestEventDto } from './dto/ingest-event.dto';
import { FunnelQueryDto } from './dto/funnel-query.dto';
import { RetentionQueryDto } from './dto/retention-query.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPrivilegedAuditPayload } from '../audit/privileged-audit.builder';

@Injectable()
export class AnalyticsEventService {
  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly auditService: AuditService,
    @InjectRepository(AnalyticsEventEntity)
    private readonly eventRepository: Repository<AnalyticsEventEntity>
  ) {}

  async ingestEvent(userId: string, payload: IngestEventDto): Promise<Record<string, unknown>> {
    await this.requireAnalyticsWrite(userId);

    const event = await this.eventRepository.save(
      this.eventRepository.create({
        actorId: userId,
        eventType: payload.event_type,
        subjectType: payload.subject_type,
        subjectId: payload.subject_id,
        occurredAt: new Date(payload.occurred_at),
        metadata: payload.metadata
      })
    );

    if (this.shouldAudit(userId)) {
      await this.auditService.appendLog(
        buildPrivilegedAuditPayload(
          {
            entityType: 'analytics_event',
            entityId: event.id,
            action: 'analytics.event.ingest',
            actorId: userId,
            accessBasis: 'permission_based',
            filters: {},
            outcome: 'success'
          },
          {
            event_type: event.eventType,
            subject_type: event.subjectType,
            subject_id: event.subjectId,
            occurred_at: event.occurredAt.toISOString()
          }
        )
      );
    }

    return {
      event_id: event.id,
      event_type: event.eventType,
      occurred_at: event.occurredAt.toISOString(),
      version: event.version
    };
  }

  async getFunnelAggregation(userId: string, query: FunnelQueryDto): Promise<Record<string, unknown>> {
    await this.requireAnalyticsRead(userId);

    const qb = this.eventRepository.createQueryBuilder('e').where('e.deleted_at IS NULL');
    qb.andWhere('e.occurred_at >= :from', { from: query.from });
    qb.andWhere('e.occurred_at <= :to', { to: query.to });
    qb.andWhere('e.event_type IN (:...eventTypes)', {
      eventTypes: ['impression', 'click', 'read_completion', 'conversion']
    });
    if (query.subject_type) {
      qb.andWhere('e.subject_type = :subjectType', { subjectType: query.subject_type });
    }

    const rows = await qb
      .select('e.event_type', 'event_type')
      .addSelect('COUNT(e.id)', 'count')
      .groupBy('e.event_type')
      .getRawMany<{ event_type: string; count: string }>();

    const stageOrder = ['impression', 'click', 'read_completion', 'conversion'];
    const stageCounts = stageOrder.map((stage) => ({
      stage,
      count: Number(rows.find((row) => row.event_type === stage)?.count ?? 0)
    }));

    const firstCount = stageCounts[0].count;
    const conversionRate = firstCount > 0 ? Number(((stageCounts[3].count / firstCount) * 100).toFixed(2)) : 0;

    if (this.shouldAudit(userId)) {
      await this.auditService.appendLog(
        buildPrivilegedAuditPayload(
          {
            entityType: 'analytics_aggregation',
            entityId: null,
            action: 'analytics.funnel.read',
            actorId: userId,
            accessBasis: 'permission_based',
            filters: {
              from: query.from,
              to: query.to,
              subject_type: query.subject_type ?? null
            },
            outcome: 'success'
          },
          { stage_counts: stageCounts, conversion_rate_percent: conversionRate }
        )
      );
    }

    return {
      from: query.from,
      to: query.to,
      stages: stageCounts,
      conversion_rate_percent: conversionRate
    };
  }

  async getRetentionAggregation(userId: string, query: RetentionQueryDto): Promise<Record<string, unknown>> {
    await this.requireAnalyticsRead(userId);

    const cohortRows = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.actor_id)', 'cohort_size')
      .where('e.event_type = :eventType', { eventType: 'impression' })
      .andWhere('e.occurred_at >= :start', { start: query.cohort_start })
      .andWhere('e.occurred_at <= :end', { end: query.cohort_end })
      .getRawOne<{ cohort_size: string }>();

    const activeRows = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.actor_id)', 'active_size')
      .where('e.event_type IN (:...eventTypes)', {
        eventTypes: ['click', 'read_completion', 'conversion']
      })
      .andWhere('e.occurred_at >= :start', { start: query.cohort_start })
      .andWhere('e.occurred_at <= :end', { end: query.cohort_end })
      .getRawOne<{ active_size: string }>();

    const cohortSize = Number(cohortRows?.cohort_size ?? 0);
    const activeSize = Number(activeRows?.active_size ?? 0);
    const retentionRate = cohortSize > 0 ? Number(((activeSize / cohortSize) * 100).toFixed(2)) : 0;

    if (this.shouldAudit(userId)) {
      await this.auditService.appendLog(
        buildPrivilegedAuditPayload(
          {
            entityType: 'analytics_aggregation',
            entityId: null,
            action: 'analytics.retention.read',
            actorId: userId,
            accessBasis: 'permission_based',
            filters: {
              cohort_start: query.cohort_start,
              cohort_end: query.cohort_end,
              bucket: query.bucket ?? 'overall'
            },
            outcome: 'success'
          },
          {
            cohort_size: cohortSize,
            retained_size: activeSize,
            retention_rate_percent: retentionRate
          }
        )
      );
    }

    return {
      cohort_start: query.cohort_start,
      cohort_end: query.cohort_end,
      bucket: query.bucket ?? 'overall',
      cohort_size: cohortSize,
      retained_size: activeSize,
      retention_rate_percent: retentionRate
    };
  }

  async getContentQualityAggregation(userId: string, query: FunnelQueryDto): Promise<Record<string, unknown>> {
    await this.requireAnalyticsRead(userId);

    const qb = this.eventRepository.createQueryBuilder('e').where('e.deleted_at IS NULL');
    qb.andWhere('e.occurred_at >= :from', { from: query.from });
    qb.andWhere('e.occurred_at <= :to', { to: query.to });
    qb.andWhere('e.event_type IN (:...eventTypes)', {
      eventTypes: ['impression', 'click', 'read_completion', 'conversion', 'share']
    });
    if (query.subject_type) {
      qb.andWhere('e.subject_type = :subjectType', { subjectType: query.subject_type });
    }

    const rows = await qb
      .select('e.event_type', 'event_type')
      .addSelect('COUNT(e.id)', 'count')
      .groupBy('e.event_type')
      .getRawMany<{ event_type: string; count: string }>();

    const getCount = (eventType: string): number => Number(rows.find((row) => row.event_type === eventType)?.count ?? 0);

    const impressionCount = getCount('impression');
    const clickCount = getCount('click');
    const completionCount = getCount('read_completion');
    const conversionCount = getCount('conversion');
    const shareCount = getCount('share');
    const engagementCount = clickCount + completionCount + conversionCount + shareCount;

    const toRate = (count: number): number => {
      if (impressionCount === 0) {
        return 0;
      }
      return Number(((count / impressionCount) * 100).toFixed(2));
    };

    const completionRate = toRate(completionCount);
    const engagementRate = toRate(engagementCount);
    const shareRate = toRate(shareCount);

    if (this.shouldAudit(userId)) {
      await this.auditService.appendLog(
        buildPrivilegedAuditPayload(
          {
            entityType: 'analytics_aggregation',
            entityId: null,
            action: 'analytics.content_quality.read',
            actorId: userId,
            accessBasis: 'permission_based',
            filters: {
              from: query.from,
              to: query.to,
              subject_type: query.subject_type ?? null
            },
            outcome: 'success'
          },
          {
            impression_count: impressionCount,
            completion_count: completionCount,
            completion_rate_percent: completionRate,
            engagement_count: engagementCount,
            engagement_rate_percent: engagementRate,
            share_count: shareCount,
            share_rate_percent: shareRate
          }
        )
      );
    }

    return {
      from: query.from,
      to: query.to,
      subject_type: query.subject_type ?? null,
      impression_count: impressionCount,
      completion_metric: {
        completion_count: completionCount,
        completion_rate_percent: completionRate
      },
      engagement_metric: {
        engagement_count: engagementCount,
        engagement_rate_percent: engagementRate
      },
      share_metric: {
        share_count: shareCount,
        share_rate_percent: shareRate
      }
    };
  }

  private async requireAnalyticsWrite(userId: string): Promise<void> {
    if (userId === 'system') {
      return;
    }
    const permissions = await this.accessControlService.getUserPermissions(userId);
    if (permissions.includes('analytics.api.use')) {
      return;
    }
    const roles = await this.accessControlService.getUserRoleNames(userId);
    if (roles.includes('ops_admin')) {
      return;
    }
    throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
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

  private shouldAudit(userId: string): boolean {
    return userId !== 'system';
  }
}
