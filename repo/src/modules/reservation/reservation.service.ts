import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { ScopePolicyService } from '../access-control/scope-policy.service';
import { AuditService } from '../audit/audit.service';
import { AccessBasis, buildPrivilegedAuditPayload } from '../audit/privileged-audit.builder';
import { AppendReservationNoteDto } from './dto/append-reservation-note.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationListQueryDto } from './dto/reservation-list-query.dto';
import { ReservationNoteEntity } from './entities/reservation-note.entity';
import { ReservationEntity, ReservationStatus, RefundStatus } from './entities/reservation.entity';
import { ReservationStateTransitionEntity } from './entities/reservation-state-transition.entity';
import { computeReservationRefund } from './reservation-refund.util';

@Injectable()
export class ReservationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scopePolicyService: ScopePolicyService,
    private readonly auditService: AuditService,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationStateTransitionEntity)
    private readonly transitionRepository: Repository<ReservationStateTransitionEntity>,
    @InjectRepository(ReservationNoteEntity)
    private readonly noteRepository: Repository<ReservationNoteEntity>
  ) {}

  async createReservation(userId: string, payload: CreateReservationDto): Promise<Record<string, unknown>> {
    const roles = await this.scopePolicyService.getRoles(userId);
    const isPatient = roles.includes('patient');
    const isStaff = roles.includes('staff');
    const isOpsAdmin = roles.includes('ops_admin');

    if (!isPatient && !isStaff && !isOpsAdmin) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    const mayAssignOtherPatient = isStaff || isOpsAdmin;
    if (isPatient && !mayAssignOtherPatient) {
      if (payload.patient_id !== undefined && payload.patient_id !== userId) {
        throw new AppException(
          'RESERVATION_PATIENT_SELF_ONLY',
          'Patients may only create reservations for themselves',
          { patient_id: payload.patient_id },
          403
        );
      }
    }

    const patientId = payload.patient_id ?? (isPatient ? userId : null);
    if (!patientId) {
      throw new AppException('RESERVATION_PATIENT_ID_REQUIRED', 'patient_id is required for non-patient callers', {}, 422);
    }

    const startTime = new Date(payload.start_time);
    const endTime = new Date(payload.end_time);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
      throw new AppException('RESERVATION_INVALID_TIME_WINDOW', 'Invalid reservation time window', {}, 422);
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let reservation: ReservationEntity;
    try {
      reservation = await qr.manager.save(ReservationEntity,
        this.reservationRepository.create({
          patientId,
          providerId: payload.provider_id ?? null,
          startTime,
          endTime,
          status: ReservationStatus.CREATED,
          version: 1
        })
      );

      await this.scopePolicyService.ensureDefaultClinicReservationScope(reservation.id, qr.manager);
      await this.scopePolicyService.assignReservationDefaultScopeFromActor(userId, reservation.id, roles, qr.manager);

      if (payload.notes) {
        await qr.manager.save(ReservationNoteEntity,
          this.noteRepository.create({
            reservationId: reservation.id,
            authorId: userId,
            note: payload.notes
          })
        );
      }

      await qr.manager.save(ReservationStateTransitionEntity,
        this.transitionRepository.create({
          reservationId: reservation.id,
          fromStatus: 'NONE',
          toStatus: ReservationStatus.CREATED,
          action: 'CREATE',
          actorId: userId,
          reason: null,
          metadata: {
            start_time: reservation.startTime?.toISOString(),
            end_time: reservation.endTime?.toISOString()
          }
        })
      );

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    const createAccessBasis: AccessBasis = isOpsAdmin ? 'ops_admin' : isStaff ? 'staff' : 'self';

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'reservation',
          entityId: reservation.id,
          action: 'reservation.create',
          actorId: userId,
          accessBasis: createAccessBasis,
          filters: {
            patient_id: patientId,
            provider_id: payload.provider_id ?? null,
            from_status: null,
            to_status: ReservationStatus.CREATED
          },
          outcome: 'success'
        },
        {
          start_time: reservation.startTime?.toISOString(),
          end_time: reservation.endTime?.toISOString()
        }
      )
    );

    return this.toReservationResponse(reservation);
  }

  /**
   * GET /reservations — role- and scope-constrained (docs/api-spec.md §5).
   *
   * - patient: only rows where patient_id = caller (self-scope).
   * - staff: full clinic operational list; optional query filters apply.
   * - ops_admin: same as staff — full list with filters for admin operations.
   * - provider: only rows where provider_id = caller; if also patient, (patient_id = caller OR provider_id = caller).
   * - merchant: same clinic scope filter as staff (reservation_data_scopes); must have assigned data scopes.
   * - analytics_viewer: this route is not an analytics reporting API → list forbidden unless caller also has patient/staff/provider/ops_admin/merchant.
   */
  async listReservations(userId: string, query: ReservationListQueryDto): Promise<Record<string, unknown>> {
    const roles = await this.scopePolicyService.getRoles(userId);
    const hasOpsAdmin = roles.includes('ops_admin');
    const hasStaff = roles.includes('staff');
    const hasProvider = roles.includes('provider');
    const hasPatient = roles.includes('patient');
    const hasMerchant = roles.includes('merchant');
    const hasAnalyticsViewer = roles.includes('analytics_viewer');

    const mayListClinicWide = hasOpsAdmin || hasStaff;
    const mayListAsProvider = hasProvider;
    const mayListAsPatient = hasPatient;
    // Merchants see reservations scoped to their assigned clinics (same scope filter as staff).
    const mayListAsMerchant = hasMerchant;

    if (
      hasAnalyticsViewer &&
      !hasOpsAdmin &&
      !hasStaff &&
      !hasProvider &&
      !hasPatient &&
      !hasMerchant
    ) {
      throw new AppException(
        'RESERVATION_LIST_FORBIDDEN',
        'Listing reservations is not permitted for this role',
        {},
        403
      );
    }

    if (!mayListClinicWide && !mayListAsProvider && !mayListAsPatient && !mayListAsMerchant) {
      throw new AppException(
        'RESERVATION_LIST_FORBIDDEN',
        'Listing reservations is not permitted for this role',
        {},
        403
      );
    }

    const qb = this.reservationRepository.createQueryBuilder('r').where('r.deleted_at IS NULL');

    await this.scopePolicyService.applyReservationScopeQuery(qb, userId, roles);

    if (query.status) {
      qb.andWhere('r.status = :status', { status: query.status });
    }
    if (query.patient_id) {
      qb.andWhere('r.patient_id = :patientId', { patientId: query.patient_id });
    }
    if (query.provider_id) {
      qb.andWhere('r.provider_id = :providerId', { providerId: query.provider_id });
    }
    if (query.from) {
      qb.andWhere('r.start_time >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('r.start_time <= :to', { to: query.to });
    }

    const sortable = new Set(['created_at', 'updated_at', 'start_time', 'status']);
    const sortBy = sortable.has(query.sort_by ?? '') ? query.sort_by ?? 'created_at' : 'created_at';
    const sortOrder = query.sort_order === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`r.${sortBy}`, sortOrder as 'ASC' | 'DESC').addOrderBy('r.id', 'DESC');

    qb.skip((query.page - 1) * query.page_size).take(query.page_size);
    const [items, total] = await qb.getManyAndCount();

    const accessBasis: AccessBasis = hasOpsAdmin
      ? 'ops_admin'
      : hasStaff
        ? 'staff'
        : hasMerchant
          ? 'merchant'
          : hasProvider
            ? 'provider'
            : 'self';

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload({
        action: 'reservation.list',
        actorId: userId,
        entityType: 'reservation',
        entityId: null,
        accessBasis,
        filters: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.patient_id ? { patient_id: query.patient_id } : {}),
          ...(query.provider_id ? { provider_id: query.provider_id } : {}),
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
          result_total: total
        },
        outcome: 'success'
      })
    );

    return {
      items: items.map((reservation) => this.toReservationResponse(reservation)),
      page: query.page,
      page_size: query.page_size,
      total
    };
  }

  async getReservationById(userId: string, reservationId: string): Promise<Record<string, unknown>> {
    const reservation = await this.getScopedReservation(userId, reservationId);
    const roles = await this.scopePolicyService.getRoles(userId);
    const accessBasis = this.reservationPrivilegedAccessBasis(roles, reservation, userId);

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload({
        action: 'reservation.read',
        actorId: userId,
        entityType: 'reservation',
        entityId: reservation.id,
        accessBasis,
        filters: { reservation_id: reservation.id },
        outcome: 'success'
      })
    );

    return {
      ...this.toReservationResponse(reservation),
      refund_preview: computeReservationRefund(reservation.startTime)
    };
  }

  async appendReservationNote(
    userId: string,
    reservationId: string,
    payload: AppendReservationNoteDto
  ): Promise<Record<string, unknown>> {
    const reservation = await this.getScopedReservation(userId, reservationId);

    const saved = await this.noteRepository.save(
      this.noteRepository.create({
        reservationId: reservation.id,
        authorId: userId,
        note: payload.note
      })
    );

    const roles = await this.scopePolicyService.getRoles(userId);
    const noteAccessBasis = this.reservationPrivilegedAccessBasis(roles, reservation, userId);

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'reservation',
          entityId: reservation.id,
          action: 'reservation.note.create',
          actorId: userId,
          accessBasis: noteAccessBasis,
          filters: { reservation_id: reservation.id, note_id: saved.id },
          outcome: 'success'
        },
        { author_id: userId, note_length: saved.note.length }
      )
    );

    return {
      note_id: saved.id,
      reservation_id: saved.reservationId,
      author_id: saved.authorId,
      note: saved.note,
      created_at: saved.createdAt.toISOString(),
      version: saved.version
    };
  }

  async confirmReservation(userId: string, reservationId: string): Promise<Record<string, unknown>> {
    const reservation = await this.getScopedReservation(userId, reservationId);
    const roles = await this.scopePolicyService.getRoles(userId);
    const canConfirm = (roles.includes('provider') && reservation.providerId === userId) || roles.includes('ops_admin') || roles.includes('staff');
    if (!canConfirm) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    if (reservation.status !== ReservationStatus.CREATED) {
      throw new AppException(
        'RESERVATION_INVALID_STATE',
        'Reservation cannot be confirmed from current state',
        { reservation_id: reservation.id },
        422
      );
    }

    const fromStatus = reservation.status;
    let updated: ReservationEntity;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const locked = await qr.manager.findOne(ReservationEntity, {
        where: { id: reservationId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' }
      });
      if (!locked || locked.version !== reservation.version) {
        throw new AppException('RESERVATION_CONCURRENT_MODIFICATION', 'Reservation was concurrently modified', {}, 409);
      }
      locked.status = ReservationStatus.CONFIRMED;
      locked.version += 1;
      updated = await qr.manager.save(ReservationEntity, locked);
      await qr.manager.save(ReservationStateTransitionEntity, this.transitionRepository.create({
        reservationId: updated.id,
        fromStatus: fromStatus ?? 'NONE',
        toStatus: updated.status,
        action: 'CONFIRM',
        actorId: userId,
        reason: null,
        metadata: {}
      }));
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    const accessBasis = this.reservationPrivilegedAccessBasis(roles, updated, userId);

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'reservation',
          entityId: updated.id,
          action: 'reservation.confirm',
          actorId: userId,
          accessBasis,
          filters: { reservation_id: updated.id, from_status: fromStatus, to_status: updated.status },
          outcome: 'success'
        },
        { reason: null }
      )
    );

    return this.toReservationResponse(updated);
  }

  async rescheduleReservation(
    userId: string,
    reservationId: string,
    payload: { new_start_time: string; new_end_time: string; reason: string }
  ): Promise<Record<string, unknown>> {
    const reservation = await this.getScopedReservation(userId, reservationId);
    const roles = await this.scopePolicyService.getRoles(userId);
    const canReschedule =
      roles.includes('ops_admin') ||
      roles.includes('staff') ||
      reservation.patientId === userId ||
      (roles.includes('provider') && reservation.providerId === userId);
    if (!canReschedule) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    if (![ReservationStatus.CONFIRMED, ReservationStatus.RESCHEDULED].includes(reservation.status)) {
      throw new AppException(
        'RESERVATION_INVALID_STATE',
        'Reservation cannot be rescheduled from current state',
        { reservation_id: reservation.id },
        422
      );
    }

    if (!reservation.startTime || Date.now() > reservation.startTime.getTime() - 2 * 60 * 60 * 1000) {
      throw new AppException(
        'RESERVATION_RESCHEDULE_CUTOFF',
        'Reservation cannot be rescheduled within 2 hours of start time',
        { reservation_id: reservation.id },
        422
      );
    }

    const newStartTime = new Date(payload.new_start_time);
    const newEndTime = new Date(payload.new_end_time);
    if (Number.isNaN(newStartTime.getTime()) || Number.isNaN(newEndTime.getTime()) || newEndTime <= newStartTime) {
      throw new AppException('RESERVATION_INVALID_TIME_WINDOW', 'Invalid reservation time window', {}, 422);
    }

    const previousStartTime = reservation.startTime?.toISOString();
    const previousEndTime = reservation.endTime?.toISOString();
    let updated: ReservationEntity;
    let fromStatus = reservation.status;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const locked = await qr.manager.findOne(ReservationEntity, {
        where: { id: reservationId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' }
      });
      if (!locked || locked.version !== reservation.version) {
        throw new AppException('RESERVATION_CONCURRENT_MODIFICATION', 'Reservation was concurrently modified', {}, 409);
      }
      fromStatus = locked.status;
      locked.startTime = newStartTime;
      locked.endTime = newEndTime;
      locked.status = ReservationStatus.RESCHEDULED;
      locked.version += 1;
      updated = await qr.manager.save(ReservationEntity, locked);
      const metadata = {
        from_start_time: previousStartTime,
        from_end_time: previousEndTime,
        to_start_time: updated.startTime?.toISOString(),
        to_end_time: updated.endTime?.toISOString()
      };
      await qr.manager.save(ReservationStateTransitionEntity, this.transitionRepository.create({
        reservationId: updated.id,
        fromStatus,
        toStatus: updated.status,
        action: 'RESCHEDULE',
        actorId: userId,
        reason: payload.reason,
        metadata
      }));
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    const rescheduleAccessBasis = this.reservationPrivilegedAccessBasis(roles, updated, userId);

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'reservation',
          entityId: updated.id,
          action: 'reservation.reschedule',
          actorId: userId,
          accessBasis: rescheduleAccessBasis,
          filters: {
            reservation_id: updated.id,
            from_status: fromStatus,
            to_status: updated.status
          },
          outcome: 'success'
        },
        {
          reason: payload.reason,
          from_start_time: previousStartTime,
          from_end_time: previousEndTime,
          to_start_time: updated.startTime?.toISOString(),
          to_end_time: updated.endTime?.toISOString()
        }
      )
    );

    return this.toReservationResponse(updated);
  }

  async cancelReservation(
    userId: string,
    reservationId: string,
    payload: { reason: string }
  ): Promise<Record<string, unknown>> {
    const reservation = await this.getScopedReservation(userId, reservationId);
    const roles = await this.scopePolicyService.getRoles(userId);
    const canCancel =
      roles.includes('ops_admin') ||
      roles.includes('staff') ||
      reservation.patientId === userId ||
      (roles.includes('provider') && reservation.providerId === userId);
    if (!canCancel) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    if (![ReservationStatus.CREATED, ReservationStatus.CONFIRMED, ReservationStatus.RESCHEDULED].includes(reservation.status)) {
      throw new AppException(
        'RESERVATION_INVALID_STATE',
        'Reservation cannot be cancelled from current state',
        { reservation_id: reservation.id },
        422
      );
    }

    const fromStatus = reservation.status;
    const refund = computeReservationRefund(reservation.startTime);
    let updated: ReservationEntity;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const locked = await qr.manager.findOne(ReservationEntity, {
        where: { id: reservationId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' }
      });
      if (!locked || locked.version !== reservation.version) {
        throw new AppException('RESERVATION_CONCURRENT_MODIFICATION', 'Reservation was concurrently modified', {}, 409);
      }
      locked.status = ReservationStatus.CANCELLED;
      locked.refundPercentage = refund.refund_percentage;
      locked.refundStatus = refund.refund_status as RefundStatus;
      locked.version += 1;
      updated = await qr.manager.save(ReservationEntity, locked);
      await qr.manager.save(ReservationStateTransitionEntity, this.transitionRepository.create({
        reservationId: updated.id,
        fromStatus,
        toStatus: updated.status,
        action: 'CANCEL',
        actorId: userId,
        reason: payload.reason,
        metadata: { refund_percentage: refund.refund_percentage, refund_status: refund.refund_status }
      }));
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    const cancelAccessBasis = this.reservationPrivilegedAccessBasis(roles, updated, userId);

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'reservation',
          entityId: updated.id,
          action: 'reservation.cancel',
          actorId: userId,
          accessBasis: cancelAccessBasis,
          filters: {
            reservation_id: updated.id,
            from_status: fromStatus,
            to_status: updated.status,
            refund_percentage: refund.refund_percentage,
            refund_status: refund.refund_status
          },
          outcome: 'success'
        },
        { reason: payload.reason }
      )
    );

    return this.toReservationResponse(updated);
  }

  async completeReservation(userId: string, reservationId: string): Promise<Record<string, unknown>> {
    const reservation = await this.getScopedReservation(userId, reservationId);
    const roles = await this.scopePolicyService.getRoles(userId);
    const canComplete = (roles.includes('provider') && reservation.providerId === userId) || roles.includes('ops_admin') || roles.includes('staff');
    if (!canComplete) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    if (![ReservationStatus.CONFIRMED, ReservationStatus.RESCHEDULED].includes(reservation.status)) {
      throw new AppException(
        'RESERVATION_INVALID_STATE',
        'Reservation cannot be completed from current state',
        { reservation_id: reservation.id },
        422
      );
    }

    const fromStatus = reservation.status;
    let updated: ReservationEntity;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const locked = await qr.manager.findOne(ReservationEntity, {
        where: { id: reservationId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' }
      });
      if (!locked || locked.version !== reservation.version) {
        throw new AppException('RESERVATION_CONCURRENT_MODIFICATION', 'Reservation was concurrently modified', {}, 409);
      }
      locked.status = ReservationStatus.COMPLETED;
      locked.version += 1;
      updated = await qr.manager.save(ReservationEntity, locked);
      await qr.manager.save(ReservationStateTransitionEntity, this.transitionRepository.create({
        reservationId: updated.id,
        fromStatus,
        toStatus: updated.status,
        action: 'COMPLETE',
        actorId: userId,
        reason: null,
        metadata: {}
      }));
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    const completeAccessBasis = this.reservationPrivilegedAccessBasis(roles, updated, userId);

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'reservation',
          entityId: updated.id,
          action: 'reservation.complete',
          actorId: userId,
          accessBasis: completeAccessBasis,
          filters: { reservation_id: updated.id, from_status: fromStatus, to_status: updated.status },
          outcome: 'success'
        },
        { reason: null }
      )
    );

    return this.toReservationResponse(updated);
  }

  async ensureReservationForAttachment(userId: string, reservationId: string): Promise<ReservationEntity> {
    return this.getScopedReservation(userId, reservationId);
  }

  /** Existence only (no data-scope check). Used when staff/ops act on support tickets tied to arbitrary reservations. */
  async ensureReservationRecordExists(reservationId: string): Promise<ReservationEntity> {
    const reservation = await this.reservationRepository.findOne({ where: { id: reservationId, deletedAt: IsNull() } });
    if (!reservation) {
      throw new AppException('NOT_FOUND', 'Reservation not found', { reservation_id: reservationId }, 404);
    }
    return reservation;
  }

  async isOpsAdmin(userId: string): Promise<boolean> {
    const roles = await this.scopePolicyService.getRoles(userId);
    return roles.includes('ops_admin');
  }

  private reservationPrivilegedAccessBasis(
    roles: string[],
    reservation: ReservationEntity,
    userId: string
  ): AccessBasis {
    if (roles.includes('ops_admin')) {
      return 'ops_admin';
    }
    if (roles.includes('staff')) {
      return 'staff';
    }
    if (roles.includes('provider') && reservation.providerId === userId) {
      return 'provider';
    }
    if (roles.includes('merchant')) {
      return 'merchant';
    }
    if (reservation.patientId === userId) {
      return 'self';
    }
    return 'permission_based';
  }

  private async getScopedReservation(userId: string, reservationId: string): Promise<ReservationEntity> {
    const reservation = await this.reservationRepository.findOne({ where: { id: reservationId, deletedAt: IsNull() } });
    if (!reservation) {
      throw new AppException('NOT_FOUND', 'Reservation not found', { reservation_id: reservationId }, 404);
    }

    const roles = await this.scopePolicyService.getRoles(userId);
    await this.scopePolicyService.assertReservationInScope(userId, reservation, roles);

    return reservation;
  }

  private toReservationResponse(reservation: ReservationEntity): Record<string, unknown> {
    return {
      reservation_id: reservation.id,
      patient_id: reservation.patientId,
      provider_id: reservation.providerId,
      status: reservation.status,
      start_time: reservation.startTime?.toISOString() ?? null,
      end_time: reservation.endTime?.toISOString() ?? null,
      refund_percentage: reservation.refundPercentage,
      refund_status: reservation.refundStatus,
      version: reservation.version,
      created_at: reservation.createdAt.toISOString(),
      updated_at: reservation.updatedAt.toISOString()
    };
  }

  private async appendTransition(
    reservationId: string,
    fromStatus: string | null,
    toStatus: string,
    action: string,
    actorId: string,
    reason?: string | null,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.transitionRepository.save(
      this.transitionRepository.create({
        reservationId,
        fromStatus: fromStatus ?? 'NONE',
        toStatus,
        action,
        actorId,
        reason: reason ?? null,
        metadata: metadata ?? {}
      })
    );

    await this.auditService.appendLog({
      entityType: 'reservation',
      entityId: reservationId,
      action: `reservation.${action.toLowerCase()}`,
      actorId,
      payload: {
        from_status: fromStatus,
        to_status: toStatus,
        reason: reason ?? null,
        ...(metadata ?? {})
      }
    });
  }
}
