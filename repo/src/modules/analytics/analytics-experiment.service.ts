import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { AccessControlService } from '../access-control/access-control.service';
import { AuditService } from '../audit/audit.service';
import { buildPrivilegedAuditPayload } from '../audit/privileged-audit.builder';
import { AppException } from '../../common/exceptions/app.exception';
import { AnalyticsExperimentEntity } from './entities/analytics-experiment.entity';
import { AnalyticsAssignmentEntity } from './entities/analytics-assignment.entity';
import { CreateExperimentDto } from './dto/create-experiment.dto';

@Injectable()
export class AnalyticsExperimentService {
  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly auditService: AuditService,
    @InjectRepository(AnalyticsExperimentEntity)
    private readonly experimentRepository: Repository<AnalyticsExperimentEntity>,
    @InjectRepository(AnalyticsAssignmentEntity)
    private readonly assignmentRepository: Repository<AnalyticsAssignmentEntity>
  ) {}

  async createExperiment(userId: string, payload: CreateExperimentDto): Promise<Record<string, unknown>> {
    await this.requireAnalyticsRead(userId);

    if (!payload.variants || payload.variants.length < 2) {
      throw new AppException('ANALYTICS_INVALID_VARIANTS', 'At least two variants are required', {}, 422);
    }

    const experiment = await this.experimentRepository.save(
      this.experimentRepository.create({
        name: payload.name,
        variants: payload.variants,
        startAt: payload.start_at ? new Date(payload.start_at) : null,
        endAt: payload.end_at ? new Date(payload.end_at) : null,
        active: payload.active
      })
    );

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'analytics_experiment',
          entityId: experiment.id,
          action: 'analytics.experiment.create',
          actorId: userId,
          accessBasis: 'permission_based',
          filters: {},
          outcome: 'success'
        },
        { variants: payload.variants }
      )
    );

    return {
      experiment_id: experiment.id,
      name: experiment.name,
      variants: experiment.variants,
      start_at: experiment.startAt?.toISOString() ?? null,
      end_at: experiment.endAt?.toISOString() ?? null,
      active: experiment.active,
      version: experiment.version
    };
  }

  async getDeterministicAssignment(userId: string, experimentId: string, targetUserId: string): Promise<Record<string, unknown>> {
    await this.requireAnalyticsRead(userId);

    const experiment = await this.experimentRepository.findOne({
      where: { id: experimentId, deletedAt: IsNull() }
    });
    if (!experiment) {
      throw new AppException('NOT_FOUND', 'Experiment not found', { experiment_id: experimentId }, 404);
    }
    if (!experiment.variants || experiment.variants.length === 0) {
      throw new AppException('ANALYTICS_INVALID_VARIANTS', 'Experiment has no variants configured', {}, 422);
    }

    const existing = await this.assignmentRepository.findOne({ where: { experimentId, userId: targetUserId } });
    if (existing) {
      await this.auditService.appendLog(
        buildPrivilegedAuditPayload(
          {
            entityType: 'analytics_experiment',
            entityId: experimentId,
            action: 'analytics.experiment.assignment.read',
            actorId: userId,
            accessBasis: 'permission_based',
            filters: { target_user_id: targetUserId },
            outcome: 'success'
          },
          { assignment_outcome: 'existing_assignment', variant: existing.variant }
        )
      );
      return {
        experiment_id: experimentId,
        user_id: targetUserId,
        variant: existing.variant,
        algorithm: existing.algorithm
      };
    }

    const hashHex = createHash('sha256').update(targetUserId).digest('hex').slice(0, 8);
    const bucket = parseInt(hashHex, 16) % experiment.variants.length;
    const variant = experiment.variants[bucket];

    const assignment = await this.assignmentRepository.save(
      this.assignmentRepository.create({
        experimentId,
        userId: targetUserId,
        variant,
        algorithm: 'hash(user_id)%N'
      })
    );

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'analytics_experiment',
          entityId: experimentId,
          action: 'analytics.experiment.assignment.read',
          actorId: userId,
          accessBasis: 'permission_based',
          filters: { target_user_id: targetUserId },
          outcome: 'success'
        },
        { assignment_outcome: 'new_assignment', variant: assignment.variant }
      )
    );

    return {
      experiment_id: assignment.experimentId,
      user_id: assignment.userId,
      variant: assignment.variant,
      algorithm: assignment.algorithm
    };
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
}
