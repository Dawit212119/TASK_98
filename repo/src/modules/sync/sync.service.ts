import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { ScopePolicyService } from '../access-control/scope-policy.service';
import { MessageEntity } from '../communication/entities/message.entity';
import { NotificationEntity } from '../communication/entities/notification.entity';
import { FollowUpPlanEntity } from '../follow-up/entities/follow-up-plan.entity';
import { FollowUpTaskEntity, FollowUpTaskStatus } from '../follow-up/entities/follow-up-task.entity';
import { ReservationEntity, ReservationStatus } from '../reservation/entities/reservation.entity';
import { ReviewEntity } from '../trust-rating/entities/review.entity';
import { WorkflowRequestEntity } from '../workflow/entities/workflow-request.entity';
import { SyncPullQueryDto } from './dto/sync-pull-query.dto';
import { SyncEntityType, SyncOperation, SyncPushDto } from './dto/sync-push.dto';

type SyncConflict = {
  entity_id: string;
  server_version: number | null;
  reason: string;
};

type SyncAccepted = {
  entity_type: SyncEntityType;
  entity_id: string;
  version: number;
  updated_at: string;
};

/** Allowed task statuses that a patient can submit via sync push. */
const PATIENT_PUSHABLE_TASK_STATUSES = new Set<string>([
  FollowUpTaskStatus.DONE,
  FollowUpTaskStatus.DEFERRED
]);

@Injectable()
export class SyncService {
  constructor(
    private readonly scopePolicyService: ScopePolicyService,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    @InjectRepository(FollowUpTaskEntity)
    private readonly followUpTaskRepository: Repository<FollowUpTaskEntity>,
    @InjectRepository(FollowUpPlanEntity)
    private readonly followUpPlanRepository: Repository<FollowUpPlanEntity>,
    @InjectRepository(WorkflowRequestEntity)
    private readonly workflowRequestRepository: Repository<WorkflowRequestEntity>,
    @InjectRepository(ReviewEntity)
    private readonly reviewRepository: Repository<ReviewEntity>
  ) {}

  async pushChanges(userId: string, payload: SyncPushDto): Promise<Record<string, unknown>> {
    const accepted: SyncAccepted[] = [];
    const conflicts: SyncConflict[] = [];

    for (const change of payload.changes) {
      const entityType = this.parseEntityType(change.entity_type);
      const operation = this.parseOperation(change.operation);

      if (entityType === SyncEntityType.RESERVATION) {
        const result = await this.applyReservationChange(userId, {
          entity_id: change.entity_id,
          operation,
          payload: change.payload,
          base_version: change.base_version,
          updated_at: change.updated_at
        });
        if ('reason' in result) {
          conflicts.push(result);
        } else {
          accepted.push(result);
        }
        continue;
      }

      if (entityType === SyncEntityType.FOLLOW_UP_TASK) {
        const result = await this.applyFollowUpTaskChange(userId, {
          entity_id: change.entity_id,
          operation,
          payload: change.payload,
          base_version: change.base_version
        });
        if ('reason' in result) {
          conflicts.push(result);
        } else {
          accepted.push(result);
        }
        continue;
      }

      throw new AppException(
        'SYNC_ENTITY_PUSH_NOT_SUPPORTED',
        `Push is not supported for entity type: ${entityType}`,
        { entity_type: entityType },
        422
      );
    }

    return { accepted, conflicts };
  }

  async pullChanges(userId: string, query: SyncPullQueryDto): Promise<Record<string, unknown>> {
    this.assertCursor(query);

    const requestedTypes = query.entity_types?.length ? query.entity_types : [SyncEntityType.RESERVATION];
    const entityTypes = Array.from(new Set(requestedTypes.map((item) => this.parseEntityType(item))));

    const changes: Array<Record<string, unknown>> = [];
    const sinceUpdatedAt = query.since_updated_at ? new Date(query.since_updated_at) : null;
    const sinceVersion = typeof query.since_version === 'number' ? query.since_version : null;
    const perEntityFetchLimit = query.page * query.page_size;

    if (entityTypes.includes(SyncEntityType.RESERVATION)) {
      const reservations = await this.getScopedReservations(userId, sinceUpdatedAt, sinceVersion, perEntityFetchLimit);
      changes.push(
        ...reservations.map((item) => ({
          entity_type: SyncEntityType.RESERVATION,
          entity_id: item.id,
          version: item.version,
          updated_at: item.updatedAt.toISOString(),
          tombstone: Boolean(item.deletedAt),
          payload: {
            status: item.status,
            start_time: item.startTime?.toISOString() ?? null,
            end_time: item.endTime?.toISOString() ?? null
          }
        }))
      );
    }

    if (entityTypes.includes(SyncEntityType.NOTIFICATION)) {
      const notifications = await this.getScopedNotifications(userId, sinceUpdatedAt, sinceVersion, perEntityFetchLimit);
      changes.push(
        ...notifications.map((item) => ({
          entity_type: SyncEntityType.NOTIFICATION,
          entity_id: item.id,
          version: item.version,
          updated_at: item.updatedAt.toISOString(),
          tombstone: Boolean(item.deletedAt),
          payload: {
            type: item.type,
            title: item.title,
            body: item.body,
            payload: item.payload,
            read_at: item.readAt?.toISOString() ?? null
          }
        }))
      );
    }

    if (entityTypes.includes(SyncEntityType.MESSAGE)) {
      const messages = await this.getScopedMessages(userId, sinceUpdatedAt, sinceVersion, perEntityFetchLimit);
      changes.push(
        ...messages.map((item) => ({
          entity_type: SyncEntityType.MESSAGE,
          entity_id: item.id,
          version: item.version,
          updated_at: item.updatedAt.toISOString(),
          tombstone: Boolean(item.deletedAt),
          payload: {
            reservation_id: item.reservationId,
            sender_id: item.senderId,
            content: item.content
          }
        }))
      );
    }

    if (entityTypes.includes(SyncEntityType.FOLLOW_UP_TASK)) {
      const tasks = await this.getScopedFollowUpTasks(userId, sinceUpdatedAt, sinceVersion, perEntityFetchLimit);
      changes.push(
        ...tasks.map((item) => ({
          entity_type: SyncEntityType.FOLLOW_UP_TASK,
          entity_id: item.id,
          version: item.version,
          updated_at: item.updatedAt.toISOString(),
          tombstone: Boolean(item.deletedAt),
          payload: {
            plan_id: item.planId,
            task_name: item.taskName,
            status: item.status,
            due_at: item.dueAt.toISOString(),
            next_due_at: item.nextDueAt?.toISOString() ?? null
          }
        }))
      );
    }

    if (entityTypes.includes(SyncEntityType.WORKFLOW_REQUEST)) {
      const requests = await this.getScopedWorkflowRequests(userId, sinceUpdatedAt, sinceVersion, perEntityFetchLimit);
      changes.push(
        ...requests.map((item) => ({
          entity_type: SyncEntityType.WORKFLOW_REQUEST,
          entity_id: item.id,
          version: item.version,
          updated_at: item.updatedAt.toISOString(),
          tombstone: Boolean(item.deletedAt),
          payload: {
            resource_type: item.resourceType,
            resource_ref: item.resourceRef,
            status: item.status,
            current_step_order: item.currentStepOrder,
            deadline_at: item.deadlineAt.toISOString()
          }
        }))
      );
    }

    if (entityTypes.includes(SyncEntityType.REVIEW)) {
      const reviews = await this.getScopedReviews(userId, sinceUpdatedAt, sinceVersion, perEntityFetchLimit);
      changes.push(
        ...reviews.map((item) => ({
          entity_type: SyncEntityType.REVIEW,
          entity_id: item.id,
          version: item.version,
          updated_at: item.updatedAt.toISOString(),
          tombstone: Boolean(item.deletedAt),
          payload: {
            reservation_id: item.reservationId,
            reviewer_user_id: item.reviewerUserId,
            target_user_id: item.targetUserId,
            dimensions: item.dimensions,
            comment: item.comment
          }
        }))
      );
    }

    const sorted = changes.sort((a, b) => {
      const updatedAtDiff = String(a.updated_at).localeCompare(String(b.updated_at));
      if (updatedAtDiff !== 0) return updatedAtDiff;
      return String(a.entity_id).localeCompare(String(b.entity_id));
    });
    const paged = sorted.slice((query.page - 1) * query.page_size, query.page * query.page_size);

    return {
      changes: paged,
      page: query.page,
      page_size: query.page_size,
      total: sorted.length
    };
  }

  // ─── Push handlers ────────────────────────────────────────────────────────

  private async applyReservationChange(
    userId: string,
    change: {
      entity_id: string;
      operation: SyncOperation;
      payload: Record<string, unknown>;
      base_version: number;
      updated_at: string;
    }
  ): Promise<SyncAccepted | SyncConflict> {
    const reservation = await this.reservationRepository.findOne({ where: { id: change.entity_id } });
    if (!reservation) {
      return this.toConflict(change.entity_id, null, 'SYNC_ENTITY_NOT_FOUND');
    }

    if (reservation.deletedAt) {
      return this.toConflict(change.entity_id, reservation.version, 'SYNC_ENTITY_DELETED');
    }

    if (reservation.version !== change.base_version) {
      return this.toConflict(change.entity_id, reservation.version, 'SYNC_VERSION_CONFLICT');
    }

    if (change.operation !== SyncOperation.UPSERT) {
      throw new AppException('SYNC_OPERATION_NOT_ALLOWED', 'Unsupported sync operation for reservation', {}, 422);
    }

    const roles = await this.scopePolicyService.getRoles(userId);
    const canUpdate =
      roles.includes('ops_admin') ||
      roles.includes('staff') ||
      (roles.includes('provider') && reservation.providerId === userId) ||
      reservation.patientId === userId;
    if (!canUpdate) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    await this.scopePolicyService.assertReservationInScope(userId, reservation, roles);

    if (![ReservationStatus.CONFIRMED, ReservationStatus.RESCHEDULED].includes(reservation.status)) {
      throw new AppException(
        'RESERVATION_INVALID_TRANSITION',
        'Only CONFIRMED or RESCHEDULED reservations can be updated via sync',
        {},
        422
      );
    }

    const startTime = typeof change.payload.start_time === 'string' ? new Date(change.payload.start_time) : null;
    const endTime = typeof change.payload.end_time === 'string' ? new Date(change.payload.end_time) : null;

    if (!startTime || !endTime || Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new AppException('SYNC_INVALID_PAYLOAD', 'start_time and end_time must be valid ISO timestamps', {}, 422);
    }

    if (endTime.getTime() <= startTime.getTime()) {
      throw new AppException('RESERVATION_INVALID_TIME_RANGE', 'end_time must be greater than start_time', {}, 422);
    }

    if (typeof change.payload.status === 'string' && change.payload.status !== reservation.status) {
      throw new AppException('SYNC_FIELD_NOT_ALLOWED', 'status cannot be changed through sync push', {}, 422);
    }

    const updatedAt = new Date(change.updated_at);
    if (Number.isNaN(updatedAt.getTime())) {
      throw new AppException('SYNC_INVALID_PAYLOAD', 'updated_at must be a valid ISO timestamp', {}, 422);
    }

    reservation.startTime = startTime;
    reservation.endTime = endTime;
    reservation.version += 1;
    reservation.updatedAt = updatedAt;
    await this.reservationRepository.save(reservation);

    return {
      entity_type: SyncEntityType.RESERVATION,
      entity_id: reservation.id,
      version: reservation.version,
      updated_at: reservation.updatedAt.toISOString()
    };
  }

  /**
   * Allow patients to mark their own follow-up tasks as DONE or DEFERRED via sync push.
   * Staff and ops_admin may also update tasks for plans within their scope.
   */
  private async applyFollowUpTaskChange(
    userId: string,
    change: {
      entity_id: string;
      operation: SyncOperation;
      payload: Record<string, unknown>;
      base_version: number;
    }
  ): Promise<SyncAccepted | SyncConflict> {
    const rolesForPush = await this.scopePolicyService.getRoles(userId);
    if (rolesForPush.includes('merchant')) {
      throw new AppException(
        'FORBIDDEN',
        'Follow-up task sync is not available for merchant accounts',
        { entity_type: SyncEntityType.FOLLOW_UP_TASK },
        403
      );
    }

    const task = await this.followUpTaskRepository.findOne({ where: { id: change.entity_id } });
    if (!task) {
      return this.toConflict(change.entity_id, null, 'SYNC_ENTITY_NOT_FOUND');
    }

    if (task.deletedAt) {
      return this.toConflict(change.entity_id, task.version, 'SYNC_ENTITY_DELETED');
    }

    if (task.version !== change.base_version) {
      return this.toConflict(change.entity_id, task.version, 'SYNC_VERSION_CONFLICT');
    }

    if (change.operation !== SyncOperation.UPSERT) {
      throw new AppException('SYNC_OPERATION_NOT_ALLOWED', 'Only UPSERT is supported for follow_up_task', {}, 422);
    }

    const plan = await this.followUpPlanRepository.findOne({ where: { id: task.planId, deletedAt: IsNull() } });
    if (!plan) {
      throw new AppException('FORBIDDEN', 'Follow-up plan is not accessible', {}, 403);
    }

    const roles = rolesForPush;
    const isPatientOwner = plan.patientId === userId;
    const isOpsAdmin = roles.includes('ops_admin');
    const isStaff = roles.includes('staff');

    if (!isPatientOwner && !isOpsAdmin && !isStaff) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions to update this task', {}, 403);
    }

    // For staff, enforce clinic-scope on the plan's reservation (if any).
    if (isStaff && !isOpsAdmin && plan.reservationId) {
      const reservation = await this.reservationRepository.findOne({ where: { id: plan.reservationId } });
      if (!reservation) {
        throw new AppException('FORBIDDEN', 'Associated reservation is not accessible', {}, 403);
      }
      await this.scopePolicyService.assertReservationInScope(userId, reservation, roles);
    }

    const newStatus = typeof change.payload.status === 'string' ? change.payload.status : null;
    if (!newStatus || !PATIENT_PUSHABLE_TASK_STATUSES.has(newStatus)) {
      throw new AppException(
        'SYNC_INVALID_PAYLOAD',
        `status must be one of: ${[...PATIENT_PUSHABLE_TASK_STATUSES].join(', ')}`,
        {},
        422
      );
    }

    task.status = newStatus as FollowUpTaskStatus;
    task.version += 1;
    const saved = await this.followUpTaskRepository.save(task);

    return {
      entity_type: SyncEntityType.FOLLOW_UP_TASK,
      entity_id: saved.id,
      version: saved.version,
      updated_at: saved.updatedAt.toISOString()
    };
  }

  // ─── Pull helpers ──────────────────────────────────────────────────────────

  private async getScopedReservations(
    userId: string,
    sinceUpdatedAt: Date | null,
    sinceVersion: number | null,
    limit: number
  ): Promise<ReservationEntity[]> {
    const roles = await this.scopePolicyService.getRoles(userId);
    const qb = this.reservationRepository.createQueryBuilder('r');

    await this.scopePolicyService.applyReservationScopeQuery(qb, userId, roles);

    if (sinceUpdatedAt) {
      qb.andWhere('r.updated_at > :sinceUpdatedAt', { sinceUpdatedAt: sinceUpdatedAt.toISOString() });
    }
    if (sinceVersion !== null) {
      qb.andWhere('r.version > :sinceVersion', { sinceVersion });
    }

    qb.orderBy('r.updated_at', 'ASC').addOrderBy('r.id', 'ASC').take(limit);
    return qb.getMany();
  }

  private getScopedNotifications(
    userId: string,
    sinceUpdatedAt: Date | null,
    sinceVersion: number | null,
    limit: number
  ): Promise<NotificationEntity[]> {
    const qb = this.notificationRepository.createQueryBuilder('n').where('n.user_id = :userId', { userId });

    if (sinceUpdatedAt) {
      qb.andWhere('n.updated_at > :sinceUpdatedAt', { sinceUpdatedAt: sinceUpdatedAt.toISOString() });
    }
    if (sinceVersion !== null) {
      qb.andWhere('n.version > :sinceVersion', { sinceVersion });
    }

    qb.orderBy('n.updated_at', 'ASC').addOrderBy('n.id', 'ASC').take(limit);
    return qb.getMany();
  }

  /**
   * Pull messages for reservations the user can access (same scope rules as reservation pull).
   */
  private async getScopedMessages(
    userId: string,
    sinceUpdatedAt: Date | null,
    sinceVersion: number | null,
    limit: number
  ): Promise<MessageEntity[]> {
    const roles = await this.scopePolicyService.getRoles(userId);
    const reservationQb = this.reservationRepository.createQueryBuilder('r');
    await this.scopePolicyService.applyReservationScopeQuery(reservationQb, userId, roles);
    const scopedReservations = await reservationQb.select('r.id', 'id').getRawMany<{ id: string }>();
    const reservationIds = scopedReservations.map((r) => r.id);

    if (reservationIds.length === 0) {
      return [];
    }

    const qb = this.messageRepository.createQueryBuilder('m').where('m.reservation_id IN (:...reservationIds)', { reservationIds });

    if (sinceUpdatedAt) {
      qb.andWhere('m.updated_at > :sinceUpdatedAt', { sinceUpdatedAt: sinceUpdatedAt.toISOString() });
    }
    if (sinceVersion !== null) {
      qb.andWhere('m.version > :sinceVersion', { sinceVersion });
    }

    qb.orderBy('m.updated_at', 'ASC').addOrderBy('m.id', 'ASC').take(limit);
    return qb.getMany();
  }

  /**
   * Pull follow-up tasks the user has access to:
   * - Patient: tasks in plans where patient_id = userId.
   * - ops_admin: all tasks.
   * - staff: tasks in plans whose reservation is in scope.
   */
  private async getScopedFollowUpTasks(
    userId: string,
    sinceUpdatedAt: Date | null,
    sinceVersion: number | null,
    limit: number
  ): Promise<FollowUpTaskEntity[]> {
    const roles = await this.scopePolicyService.getRoles(userId);
    if (roles.includes('merchant')) {
      throw new AppException(
        'FORBIDDEN',
        'Follow-up task sync is not available for merchant accounts',
        { entity_type: SyncEntityType.FOLLOW_UP_TASK },
        403
      );
    }

    const isOpsAdmin = roles.includes('ops_admin');

    const planQb = this.followUpPlanRepository.createQueryBuilder('p').where('p.deleted_at IS NULL');
    if (!isOpsAdmin) {
      const orClauses: string[] = ['p.patient_id = :userId'];
      if (roles.includes('staff')) {
        const scopeIds = await this.scopePolicyService.getUserScopeIds(userId);
        if (scopeIds.length > 0) {
          orClauses.push(
            `EXISTS (
              SELECT 1 FROM reservation_data_scopes rds
              WHERE rds.reservation_id = p.reservation_id
                AND rds.deleted_at IS NULL
                AND rds.scope_id IN (:...scopeIds)
            )`
          );
          planQb.setParameter('scopeIds', scopeIds);
        }
      }
      planQb.andWhere(`(${orClauses.join(' OR ')})`, { userId });
    }

    const accessiblePlans = await planQb.select('p.id', 'id').getRawMany<{ id: string }>();
    const planIds = accessiblePlans.map((p) => p.id);

    if (planIds.length === 0) {
      return [];
    }

    const qb = this.followUpTaskRepository.createQueryBuilder('t').where('t.plan_id IN (:...planIds)', { planIds });

    if (sinceUpdatedAt) {
      qb.andWhere('t.updated_at > :sinceUpdatedAt', { sinceUpdatedAt: sinceUpdatedAt.toISOString() });
    }
    if (sinceVersion !== null) {
      qb.andWhere('t.version > :sinceVersion', { sinceVersion });
    }

    qb.orderBy('t.updated_at', 'ASC').addOrderBy('t.id', 'ASC').take(limit);
    return qb.getMany();
  }

  /**
   * Pull workflow requests submitted by the user (or all, for ops_admin).
   */
  private async getScopedWorkflowRequests(
    userId: string,
    sinceUpdatedAt: Date | null,
    sinceVersion: number | null,
    limit: number
  ): Promise<WorkflowRequestEntity[]> {
    const roles = await this.scopePolicyService.getRoles(userId);
    const isOpsAdmin = roles.includes('ops_admin');

    const qb = this.workflowRequestRepository.createQueryBuilder('wr');
    if (!isOpsAdmin) {
      qb.where('wr.requested_by = :userId', { userId });
    } else {
      qb.where('1 = 1');
    }

    if (sinceUpdatedAt) {
      qb.andWhere('wr.updated_at > :sinceUpdatedAt', { sinceUpdatedAt: sinceUpdatedAt.toISOString() });
    }
    if (sinceVersion !== null) {
      qb.andWhere('wr.version > :sinceVersion', { sinceVersion });
    }

    qb.orderBy('wr.updated_at', 'ASC').addOrderBy('wr.id', 'ASC').take(limit);
    return qb.getMany();
  }

  /**
   * Pull reviews where the user is the reviewer or the review target.
   */
  private getScopedReviews(
    userId: string,
    sinceUpdatedAt: Date | null,
    sinceVersion: number | null,
    limit: number
  ): Promise<ReviewEntity[]> {
    const qb = this.reviewRepository
      .createQueryBuilder('rv')
      .where('rv.reviewer_user_id = :userId OR rv.target_user_id = :userId', { userId });

    if (sinceUpdatedAt) {
      qb.andWhere('rv.updated_at > :sinceUpdatedAt', { sinceUpdatedAt: sinceUpdatedAt.toISOString() });
    }
    if (sinceVersion !== null) {
      qb.andWhere('rv.version > :sinceVersion', { sinceVersion });
    }

    qb.orderBy('rv.updated_at', 'ASC').addOrderBy('rv.id', 'ASC').take(limit);
    return qb.getMany();
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  private parseEntityType(entityType: string): SyncEntityType {
    const valid = Object.values(SyncEntityType) as string[];
    if (valid.includes(entityType)) {
      return entityType as SyncEntityType;
    }
    throw new AppException('SYNC_ENTITY_NOT_SUPPORTED', 'Unknown sync entity_type', { entity_type: entityType }, 422);
  }

  private parseOperation(operation: string): SyncOperation {
    if (operation === SyncOperation.UPSERT || operation === SyncOperation.DELETE) {
      return operation;
    }
    throw new AppException('SYNC_OPERATION_NOT_SUPPORTED', 'Unknown sync operation', { operation }, 422);
  }

  private assertCursor(query: SyncPullQueryDto): void {
    if (!query.since_updated_at && !query.since_version) {
      throw new AppException('SYNC_CURSOR_REQUIRED', 'Either since_updated_at or since_version is required', {}, 422);
    }
  }

  private toConflict(entityId: string, serverVersion: number | null, reason: string): SyncConflict {
    return { entity_id: entityId, server_version: serverVersion, reason };
  }
}
