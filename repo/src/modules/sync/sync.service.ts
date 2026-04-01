import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { ScopePolicyService } from '../access-control/scope-policy.service';
import { NotificationEntity } from '../communication/entities/notification.entity';
import { ReservationEntity, ReservationStatus } from '../reservation/entities/reservation.entity';
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

@Injectable()
export class SyncService {
  constructor(
    private readonly scopePolicyService: ScopePolicyService,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>
  ) {}

  async pushChanges(userId: string, payload: SyncPushDto): Promise<Record<string, unknown>> {
    const accepted: SyncAccepted[] = [];
    const conflicts: SyncConflict[] = [];

    for (const change of payload.changes) {
      const entityType = this.parseEntityType(change.entity_type);
      const operation = this.parseOperation(change.operation);

      if (entityType !== SyncEntityType.RESERVATION) {
        throw new AppException('SYNC_ENTITY_PUSH_NOT_SUPPORTED', 'Push currently supports reservation entities only', {}, 422);
      }

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
    }

    return {
      accepted,
      conflicts
    };
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

    const sorted = changes.sort((a, b) => {
      const updatedAtDiff = String(a.updated_at).localeCompare(String(b.updated_at));
      if (updatedAtDiff !== 0) {
        return updatedAtDiff;
      }
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

    if (reservation.status !== ReservationStatus.CONFIRMED) {
      throw new AppException('RESERVATION_INVALID_TRANSITION', 'Only CONFIRMED reservations can be updated via sync', {}, 422);
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

  private parseEntityType(entityType: string): SyncEntityType {
    if (entityType === SyncEntityType.RESERVATION || entityType === SyncEntityType.NOTIFICATION) {
      return entityType;
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
    return {
      entity_id: entityId,
      server_version: serverVersion,
      reason
    };
  }
}
