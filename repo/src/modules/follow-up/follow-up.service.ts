import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { AccessControlService } from '../access-control/access-control.service';
import { ScopePolicyService } from '../access-control/scope-policy.service';
import { AuditService } from '../audit/audit.service';
import { ReservationEntity } from '../reservation/entities/reservation.entity';
import { AdherenceQueryDto } from './dto/adherence-query.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreatePlanTemplateDto } from './dto/create-plan-template.dto';
import { IngestTagsDto } from './dto/ingest-tags.dto';
import { FollowUpOutcomeStatus, RecordTaskOutcomeDto } from './dto/record-task-outcome.dto';
import { FollowUpOutcomeEntity } from './entities/follow-up-outcome.entity';
import { FollowUpPlanEntity, FollowUpPlanStatus } from './entities/follow-up-plan.entity';
import { FollowUpPlanTemplateEntity } from './entities/follow-up-plan-template.entity';
import { FollowUpTagEntity } from './entities/follow-up-tag.entity';
import { FollowUpTaskEntity, FollowUpTaskStatus } from './entities/follow-up-task.entity';
import { buildSchedules } from './follow-up-frequency.util';

@Injectable()
export class FollowUpService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly accessControlService: AccessControlService,
    private readonly scopePolicyService: ScopePolicyService,
    private readonly auditService: AuditService,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(FollowUpTagEntity)
    private readonly tagRepository: Repository<FollowUpTagEntity>,
    @InjectRepository(FollowUpPlanTemplateEntity)
    private readonly templateRepository: Repository<FollowUpPlanTemplateEntity>,
    @InjectRepository(FollowUpPlanEntity)
    private readonly planRepository: Repository<FollowUpPlanEntity>,
    @InjectRepository(FollowUpTaskEntity)
    private readonly taskRepository: Repository<FollowUpTaskEntity>,
    @InjectRepository(FollowUpOutcomeEntity)
    private readonly outcomeRepository: Repository<FollowUpOutcomeEntity>
  ) {}

  async ingestTags(userId: string, payload: IngestTagsDto): Promise<Record<string, unknown>> {
    await this.requireAnyRole(userId, ['provider', 'staff', 'merchant']);
    const reservation = await this.ensureReservationExists(payload.reservation_id);
    await this.scopePolicyService.assertReservationInScope(userId, reservation);

    const entities = payload.tags.map((tag) =>
      this.tagRepository.create({
        reservationId: payload.reservation_id,
        key: tag.key,
        value: tag.value,
        source: tag.source,
        ingestedBy: userId
      })
    );

    const saved = await this.tagRepository.save(entities);

    await this.auditService.appendLog({
      entityType: 'follow_up_tag',
      entityId: payload.reservation_id,
      action: 'follow_up.tags.ingest',
      actorId: userId,
      payload: {
        reservation_id: payload.reservation_id,
        tags_count: saved.length
      }
    });

    return {
      reservation_id: payload.reservation_id,
      tags: saved.map((item) => ({
        tag_id: item.id,
        key: item.key,
        value: item.value,
        source: item.source,
        created_at: item.createdAt.toISOString()
      }))
    };
  }

  async createPlanTemplate(userId: string, payload: CreatePlanTemplateDto): Promise<Record<string, unknown>> {
    await this.requireAnyRole(userId, ['provider', 'staff']);

    for (const rule of payload.task_rules) {
      const hasDays = typeof rule.every_n_days === 'number';
      const hasMonths = typeof rule.every_n_months === 'number';
      if (hasDays === hasMonths) {
        throw new AppException(
          'FOLLOW_UP_INVALID_TASK_RULE',
          'Each task rule must define exactly one frequency: every_n_days or every_n_months',
          {},
          422
        );
      }
    }

    const template = await this.templateRepository.save(
      this.templateRepository.create({
        name: payload.name,
        triggerTags: payload.trigger_tags,
        taskRules: payload.task_rules,
        active: payload.active,
        createdBy: userId
      })
    );

    await this.auditService.appendLog({
      entityType: 'follow_up_plan_template',
      entityId: template.id,
      action: 'follow_up.plan_template.create',
      actorId: userId,
      payload: {
        task_rules_count: payload.task_rules.length,
        active: payload.active
      }
    });

    return {
      template_id: template.id,
      name: template.name,
      trigger_tags: template.triggerTags,
      task_rules: template.taskRules,
      active: template.active,
      version: template.version,
      created_at: template.createdAt.toISOString(),
      updated_at: template.updatedAt.toISOString()
    };
  }

  async createPlan(userId: string, payload: CreatePlanDto): Promise<Record<string, unknown>> {
    await this.requireAnyRole(userId, ['provider', 'staff']);
    const roles = await this.scopePolicyService.getRoles(userId);

    if (payload.reservation_id) {
      const reservation = await this.ensureReservationExists(payload.reservation_id);
      await this.scopePolicyService.assertReservationInScope(userId, reservation, roles);
      if (reservation.patientId !== payload.patient_id) {
        throw new AppException(
          'FOLLOW_UP_PATIENT_MISMATCH',
          'patient_id must match reservation patient for reservation-bound plans',
          { reservation_id: reservation.id },
          422
        );
      }
    } else {
      const canCreateStandalonePlan = roles.includes('ops_admin') || payload.patient_id === userId;
      if (!canCreateStandalonePlan) {
        throw new AppException(
          'FOLLOW_UP_STANDALONE_PLAN_FORBIDDEN',
          'Standalone follow-up plans are restricted to self or ops_admin',
          {},
          403
        );
      }
    }

    const template = await this.templateRepository.findOne({
      where: {
        id: payload.template_id,
        active: true,
        deletedAt: IsNull()
      }
    });

    if (!template) {
      throw new AppException('FOLLOW_UP_TEMPLATE_NOT_FOUND', 'Plan template not found', {}, 404);
    }

    const startDate = new Date(`${payload.start_date}T00:00:00.000Z`);
    const taskRows: FollowUpTaskEntity[] = [];

    let plan: FollowUpPlanEntity;
    let tasks: FollowUpTaskEntity[];

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      plan = await qr.manager.save(FollowUpPlanEntity, this.planRepository.create({
        patientId: payload.patient_id,
        reservationId: payload.reservation_id ?? null,
        templateId: template.id,
        startDate: payload.start_date,
        status: FollowUpPlanStatus.ACTIVE,
        createdBy: userId
      }));

      for (const rule of template.taskRules) {
        const schedules = buildSchedules(startDate, rule);
        for (const schedule of schedules) {
          taskRows.push(
            this.taskRepository.create({
              planId: plan.id,
              taskName: schedule.taskName,
              ruleType: schedule.ruleType,
              ruleValue: schedule.ruleValue,
              sequenceNo: schedule.sequenceNo,
              dueAt: schedule.dueAt,
              nextDueAt: schedule.nextDueAt,
              status: FollowUpTaskStatus.PENDING
            })
          );
        }
      }

      tasks = taskRows.length > 0 ? await qr.manager.save(FollowUpTaskEntity, taskRows) : [];
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    await this.auditService.appendLog({
      entityType: 'follow_up_plan',
      entityId: plan.id,
      action: 'follow_up.plan.create',
      actorId: userId,
      payload: {
        patient_id: payload.patient_id,
        reservation_id: payload.reservation_id ?? null,
        tasks_generated: tasks.length
      }
    });

    return {
      plan_id: plan.id,
      patient_id: plan.patientId,
      reservation_id: plan.reservationId,
      template_id: plan.templateId,
      start_date: plan.startDate,
      status: plan.status,
      version: plan.version,
      tasks: tasks.map((task) => this.mapTask(task))
    };
  }

  async getPlanById(userId: string, planId: string): Promise<Record<string, unknown>> {
    const plan = await this.planRepository.findOne({ where: { id: planId, deletedAt: IsNull() } });
    if (!plan) {
      throw new AppException('FOLLOW_UP_PLAN_NOT_FOUND', 'Plan not found', {}, 404);
    }

    const roles = await this.scopePolicyService.getRoles(userId);
    await this.assertPlanAccess(userId, plan, roles, false);

    const tasks = await this.taskRepository.find({
      where: { planId: plan.id, deletedAt: IsNull() },
      order: { dueAt: 'ASC', sequenceNo: 'ASC' }
    });

    return {
      plan_id: plan.id,
      patient_id: plan.patientId,
      reservation_id: plan.reservationId,
      template_id: plan.templateId,
      start_date: plan.startDate,
      status: plan.status,
      version: plan.version,
      tasks: tasks.map((task) => this.mapTask(task))
    };
  }

  async recordTaskOutcome(userId: string, taskId: string, payload: RecordTaskOutcomeDto): Promise<Record<string, unknown>> {
    await this.requireAnyRole(userId, ['provider', 'staff']);
    const roles = await this.scopePolicyService.getRoles(userId);

    const task = await this.taskRepository.findOne({ where: { id: taskId, deletedAt: IsNull() } });
    if (!task) {
      throw new AppException('FOLLOW_UP_TASK_NOT_FOUND', 'Task not found', {}, 404);
    }

    const plan = await this.planRepository.findOne({ where: { id: task.planId, deletedAt: IsNull() } });
    if (!plan) {
      throw new AppException('FOLLOW_UP_PLAN_NOT_FOUND', 'Plan not found', {}, 404);
    }

    await this.assertPlanAccess(userId, plan, roles, true);

    const outcome = await this.outcomeRepository.save(
      this.outcomeRepository.create({
        taskId,
        recordedBy: userId,
        status: payload.status,
        outcomePayload: payload.outcome_payload,
        adherenceScore: payload.adherence_score
      })
    );

    task.status = this.mapOutcomeStatusToTaskStatus(payload.status);
    task.version += 1;
    await this.taskRepository.save(task);

    await this.auditService.appendLog({
      entityType: 'follow_up_outcome',
      entityId: outcome.id,
      action: 'follow_up.task.outcome.record',
      actorId: userId,
      payload: {
        task_id: taskId,
        status: payload.status,
        adherence_score: payload.adherence_score
      }
    });

    return {
      outcome_id: outcome.id,
      task_id: outcome.taskId,
      status: outcome.status,
      adherence_score: Number(outcome.adherenceScore),
      outcome_payload: outcome.outcomePayload,
      created_at: outcome.createdAt.toISOString(),
      version: outcome.version
    };
  }

  async getAdherenceMetrics(userId: string, query: AdherenceQueryDto): Promise<Record<string, unknown>> {
    await this.requireAnyRole(userId, ['provider', 'staff', 'analytics_viewer', 'ops_admin']);
    const roles = await this.scopePolicyService.getRoles(userId);
    const hasOpsAdmin = roles.includes('ops_admin');
    const hasStaff = roles.includes('staff');
    const hasProvider = roles.includes('provider');
    const hasAnalyticsViewer = roles.includes('analytics_viewer');
    const hasPatient = roles.includes('patient');

    if (!hasOpsAdmin && !hasStaff && !hasProvider && !hasAnalyticsViewer && !hasPatient) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    const qb = this.outcomeRepository
      .createQueryBuilder('o')
      .innerJoin(FollowUpTaskEntity, 't', 't.id = o.task_id AND t.deleted_at IS NULL')
      .innerJoin(FollowUpPlanEntity, 'p', 'p.id = t.plan_id AND p.deleted_at IS NULL')
      .leftJoin(ReservationEntity, 'r', 'r.id = p.reservation_id AND r.deleted_at IS NULL')
      .where('o.deleted_at IS NULL');

    if (!hasOpsAdmin) {
      const scopeClauses: string[] = [];
      if (hasPatient) {
        scopeClauses.push('p.patient_id = :scopeUserId');
      }
      if (hasProvider) {
        scopeClauses.push('r.provider_id = :scopeUserId');
        scopeClauses.push('p.created_by = :scopeUserId');
      }
      if (hasStaff) {
        const scopeIds = await this.scopePolicyService.getUserScopeIds(userId);
        if (scopeIds.length > 0) {
          scopeClauses.push(
            `EXISTS (
              SELECT 1
              FROM reservation_data_scopes rds
              WHERE rds.reservation_id = p.reservation_id
                AND rds.deleted_at IS NULL
                AND rds.scope_id IN (:...scopeIds)
            )`
          );
          qb.setParameter('scopeIds', scopeIds);
        }
        scopeClauses.push('p.created_by = :scopeUserId');
      }
      if (hasAnalyticsViewer) {
        scopeClauses.push('p.id IS NOT NULL');
      }

      if (scopeClauses.length === 0) {
        throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
      }

      qb.andWhere(`(${scopeClauses.join(' OR ')})`, { scopeUserId: userId });
    }

    if (query.patient_id) {
      qb.andWhere('p.patient_id = :patientId', { patientId: query.patient_id });
    }

    if (query.provider_id) {
      qb.andWhere('p.created_by = :providerId', { providerId: query.provider_id });
    }

    if (query.from) {
      qb.andWhere('o.created_at >= :from', { from: query.from });
    }

    if (query.to) {
      qb.andWhere('o.created_at <= :to', { to: query.to });
    }

    const rows = await qb
      .select('o.status', 'status')
      .addSelect('COUNT(o.id)', 'count')
      .addSelect('AVG(o.adherence_score)', 'avg_adherence')
      .groupBy('o.status')
      .getRawMany<{ status: FollowUpOutcomeStatus; count: string; avg_adherence: string }>();

    const totalOutcomes = rows.reduce((sum, row) => sum + Number(row.count), 0);
    const weightedAdherenceSum = rows.reduce((sum, row) => sum + Number(row.count) * Number(row.avg_adherence), 0);

    return {
      total_outcomes: totalOutcomes,
      avg_adherence_score: totalOutcomes > 0 ? Number((weightedAdherenceSum / totalOutcomes).toFixed(2)) : 0,
      by_status: rows.map((row) => ({
        status: row.status,
        count: Number(row.count),
        avg_adherence_score: Number(Number(row.avg_adherence).toFixed(2))
      }))
    };
  }

  private mapTask(task: FollowUpTaskEntity): Record<string, unknown> {
    return {
      task_id: task.id,
      task_name: task.taskName,
      status: task.status,
      rule: {
        type: task.ruleType,
        value: task.ruleValue
      },
      sequence_no: task.sequenceNo,
      due_at: task.dueAt.toISOString(),
      next_due_at: task.nextDueAt?.toISOString() ?? null,
      version: task.version
    };
  }

  private mapOutcomeStatusToTaskStatus(status: FollowUpOutcomeStatus): FollowUpTaskStatus {
    switch (status) {
      case FollowUpOutcomeStatus.DONE:
        return FollowUpTaskStatus.DONE;
      case FollowUpOutcomeStatus.MISSED:
        return FollowUpTaskStatus.MISSED;
      case FollowUpOutcomeStatus.DEFERRED:
        return FollowUpTaskStatus.DEFERRED;
      default:
        return FollowUpTaskStatus.PENDING;
    }
  }

  private async requireAnyRole(userId: string, allowedRoles: string[]): Promise<void> {
    const roles = await this.accessControlService.getUserRoleNames(userId);
    const allowed = roles.some((role) => allowedRoles.includes(role));
    if (!allowed) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }
  }

  private async ensureReservationExists(reservationId: string): Promise<ReservationEntity> {
    const exists = await this.reservationRepository.findOne({ where: { id: reservationId, deletedAt: IsNull() } });
    if (!exists) {
      throw new AppException('NOT_FOUND', 'Reservation not found', { reservation_id: reservationId }, 404);
    }
    return exists;
  }

  private async assertPlanAccess(
    userId: string,
    plan: FollowUpPlanEntity,
    roles: string[],
    requiresProviderOrStaffMutation: boolean
  ): Promise<void> {
    const hasOpsAdmin = roles.includes('ops_admin');
    if (hasOpsAdmin) {
      return;
    }

    if (requiresProviderOrStaffMutation && !roles.includes('provider') && !roles.includes('staff')) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    if (plan.reservationId) {
      const reservation = await this.reservationRepository.findOne({ where: { id: plan.reservationId, deletedAt: IsNull() } });
      if (!reservation) {
        throw new AppException('FORBIDDEN', 'Plan is out of scope', {}, 403);
      }

      await this.scopePolicyService.assertReservationInScope(userId, reservation, roles);
      return;
    }

    const isPatientOwner = plan.patientId === userId;
    const isCreator = Boolean(plan.createdBy && plan.createdBy === userId);
    if (isPatientOwner || isCreator) {
      return;
    }

    throw new AppException('FORBIDDEN', 'Plan is out of scope', {}, 403);
  }
}
