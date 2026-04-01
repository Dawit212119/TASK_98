import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditLogEntity } from './audit-log.entity';
import { AuditRetentionRunEntity } from './audit-retention-run.entity';
import { AuditService } from './audit.service';

@Injectable()
export class AuditRetentionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    @InjectRepository(AuditLogEntity)
    private readonly auditRepository: Repository<AuditLogEntity>,
    @InjectRepository(AuditRetentionRunEntity)
    private readonly retentionRunRepository: Repository<AuditRetentionRunEntity>
  ) {}

  getRetentionYears(): number {
    const configuredYears = this.configService.get<number>('AUDIT_RETENTION_YEARS');
    if (typeof configuredYears !== 'number' || Number.isNaN(configuredYears) || configuredYears < 1) {
      return 7;
    }

    return Math.floor(configuredYears);
  }

  getRetentionThreshold(referenceDate: Date = new Date()): Date {
    const threshold = new Date(referenceDate.getTime());
    threshold.setUTCFullYear(threshold.getUTCFullYear() - this.getRetentionYears());
    return threshold;
  }

  isOlderThanRetention(createdAt: Date, referenceDate: Date = new Date()): boolean {
    const threshold = this.getRetentionThreshold(referenceDate);
    return createdAt.getTime() < threshold.getTime();
  }

  async identifyRecordsOlderThanRetention(referenceDate: Date = new Date(), limit = 1000): Promise<AuditLogEntity[]> {
    const threshold = this.getRetentionThreshold(referenceDate);
    return this.auditRepository
      .createQueryBuilder('audit')
      .where('audit.deleted_at IS NULL')
      .andWhere('audit.created_at < :threshold', { threshold: threshold.toISOString() })
      .orderBy('audit.created_at', 'ASC')
      .addOrderBy('audit.id', 'ASC')
      .take(limit)
      .getMany();
  }

  async runProtectedRetentionJob(
    actorId: string | null,
    input?: { referenceDate?: Date; limit?: number }
  ): Promise<{
    retention_years: number;
    threshold_at: string;
    candidate_count: number;
    deleted_count: number;
    strategy: string;
    marker_id: string;
  }> {
    const referenceDate = input?.referenceDate ?? new Date();
    const threshold = this.getRetentionThreshold(referenceDate);
    const candidates = await this.identifyRecordsOlderThanRetention(referenceDate, input?.limit ?? 1000);

    const hasOutOfPolicyCandidate = candidates.some((item) => item.createdAt.getTime() >= threshold.getTime());
    if (hasOutOfPolicyCandidate) {
      throw new AppException('AUDIT_RETENTION_GUARD_VIOLATION', 'Retention guard blocked non-eligible audit record', {}, 422);
    }

    const marker = await this.retentionRunRepository.save(
      this.retentionRunRepository.create({
        retentionYears: this.getRetentionYears(),
        thresholdAt: threshold,
        candidateCount: candidates.length,
        strategy: 'PROTECTED_NO_DELETE',
        createdBy: actorId
      })
    );

    await this.auditService.appendLog({
      entityType: 'audit_retention_run',
      entityId: marker.id,
      action: 'audit.retention.run',
      actorId,
      payload: {
        retention_years: marker.retentionYears,
        threshold_at: threshold.toISOString(),
        candidate_count: marker.candidateCount,
        strategy: marker.strategy,
        protected_cleanup: true
      }
    });

    return {
      retention_years: marker.retentionYears,
      threshold_at: threshold.toISOString(),
      candidate_count: marker.candidateCount,
      deleted_count: 0,
      strategy: marker.strategy,
      marker_id: marker.id
    };
  }
}
