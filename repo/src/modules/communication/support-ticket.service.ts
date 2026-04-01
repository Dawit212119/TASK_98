import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../audit/audit.service';
import { ReservationService } from '../reservation/reservation.service';
import { ScopePolicyService } from '../access-control/scope-policy.service';
import { NotificationService } from './notification.service';
import { SupportTicketEntity } from './entities/support-ticket.entity';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { SupportTicketListQueryDto } from './dto/support-ticket-list-query.dto';

const SUPPORT_TICKET_STATUS_OPEN = 'OPEN';
const SUPPORT_TICKET_STATUS_ESCALATED = 'ESCALATED';
const SUPPORT_TICKET_STATUS_RESOLVED = 'RESOLVED';
const SUPPORT_TICKET_STATUS_CLOSED = 'CLOSED';

@Injectable()
export class SupportTicketService {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly scopePolicyService: ScopePolicyService,
    private readonly auditService: AuditService,
    private readonly notificationService: NotificationService,
    @InjectRepository(SupportTicketEntity)
    private readonly supportTicketRepository: Repository<SupportTicketEntity>
  ) {}

  async createSupportTicket(userId: string, payload: CreateSupportTicketDto): Promise<Record<string, unknown>> {
    await this.reservationService.ensureReservationForAttachment(userId, payload.reservation_id);

    const ticket = await this.supportTicketRepository.save(
      this.supportTicketRepository.create({
        reservationId: payload.reservation_id,
        ownerUserId: userId,
        category: payload.category,
        description: payload.description,
        messageId: payload.message_id ?? null,
        status: SUPPORT_TICKET_STATUS_OPEN
      })
    );

    await this.auditService.appendLog({
      entityType: 'support_ticket',
      entityId: ticket.id,
      action: 'support.ticket.create',
      actorId: userId,
      payload: {
        reservation_id: payload.reservation_id,
        category: payload.category
      }
    });

    return this.mapSupportTicket(ticket);
  }

  async escalateSupportTicket(
    userId: string,
    ticketId: string,
    payload: { reason?: string }
  ): Promise<Record<string, unknown>> {
    const ticket = await this.getSupportTicketOrThrow(ticketId);

    const roles = await this.scopePolicyService.getRoles(userId);
    const isStaffOrOps = roles.includes('staff') || roles.includes('ops_admin');
    const isOwner = ticket.ownerUserId === userId;

    if (!isStaffOrOps && !isOwner) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    if (isOwner) {
      await this.reservationService.ensureReservationForAttachment(userId, ticket.reservationId);
    } else {
      await this.reservationService.ensureReservationRecordExists(ticket.reservationId);
    }
    if (ticket.status !== SUPPORT_TICKET_STATUS_OPEN) {
      throw new AppException('SUPPORT_TICKET_INVALID_STATE', 'Ticket cannot be escalated from current state', {}, 422);
    }

    ticket.status = SUPPORT_TICKET_STATUS_ESCALATED;
    ticket.version += 1;
    const saved = await this.supportTicketRepository.save(ticket);

    await this.auditService.appendLog({
      entityType: 'support_ticket',
      entityId: saved.id,
      action: 'support.ticket.escalate',
      actorId: userId,
      payload: {
        reservation_id: saved.reservationId,
        owner_user_id: saved.ownerUserId,
        reason: payload.reason ?? null
      }
    });

    await this.notificationService.notifyTicketOwner(saved.ownerUserId, userId, 'support_ticket_escalated', 'Support ticket escalated', {
      ticket_id: saved.id,
      reservation_id: saved.reservationId,
      reason: payload.reason ?? null
    });

    return this.mapSupportTicket(saved);
  }

  async resolveSupportTicket(
    userId: string,
    ticketId: string,
    payload: { resolution_note?: string }
  ): Promise<Record<string, unknown>> {
    const ticket = await this.getSupportTicketOrThrow(ticketId);

    const roles = await this.scopePolicyService.getRoles(userId);
    const isStaffOrOps = roles.includes('staff') || roles.includes('ops_admin');
    if (!isStaffOrOps) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    await this.reservationService.ensureReservationRecordExists(ticket.reservationId);

    const validSourceStatuses = new Set([SUPPORT_TICKET_STATUS_OPEN, SUPPORT_TICKET_STATUS_ESCALATED]);
    if (!validSourceStatuses.has(ticket.status)) {
      throw new AppException('SUPPORT_TICKET_INVALID_STATE', 'Ticket cannot be resolved from current state', {}, 422);
    }

    const previousStatus = ticket.status;
    ticket.status = SUPPORT_TICKET_STATUS_RESOLVED;
    ticket.version += 1;
    const saved = await this.supportTicketRepository.save(ticket);

    await this.auditService.appendLog({
      entityType: 'support_ticket',
      entityId: saved.id,
      action: 'support.ticket.resolve',
      actorId: userId,
      payload: {
        reservation_id: saved.reservationId,
        previous_status: previousStatus,
        resolution_note: payload.resolution_note ?? null
      }
    });

    await this.notificationService.notifyTicketOwner(saved.ownerUserId, userId, 'support_ticket_resolved', 'Support ticket resolved', {
      ticket_id: saved.id,
      reservation_id: saved.reservationId,
      resolution_note: payload.resolution_note ?? null,
      previous_status: previousStatus
    });

    return this.mapSupportTicket(saved);
  }

  async closeSupportTicket(userId: string, ticketId: string, payload: { close_note?: string }): Promise<Record<string, unknown>> {
    const ticket = await this.getSupportTicketOrThrow(ticketId);

    const roles = await this.scopePolicyService.getRoles(userId);
    const isStaffOrOps = roles.includes('staff') || roles.includes('ops_admin');
    if (!isStaffOrOps) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    await this.reservationService.ensureReservationRecordExists(ticket.reservationId);

    if (ticket.status !== SUPPORT_TICKET_STATUS_RESOLVED) {
      throw new AppException('SUPPORT_TICKET_INVALID_STATE', 'Ticket can only be closed after resolution', {}, 422);
    }

    ticket.status = SUPPORT_TICKET_STATUS_CLOSED;
    ticket.version += 1;
    const saved = await this.supportTicketRepository.save(ticket);

    await this.auditService.appendLog({
      entityType: 'support_ticket',
      entityId: saved.id,
      action: 'support.ticket.close',
      actorId: userId,
      payload: {
        reservation_id: saved.reservationId,
        close_note: payload.close_note ?? null
      }
    });

    await this.notificationService.notifyTicketOwner(saved.ownerUserId, userId, 'support_ticket_closed', 'Support ticket closed', {
      ticket_id: saved.id,
      reservation_id: saved.reservationId,
      close_note: payload.close_note ?? null
    });

    return this.mapSupportTicket(saved);
  }

  async listSupportTickets(userId: string, query: SupportTicketListQueryDto): Promise<Record<string, unknown>> {
    const roles = await this.scopePolicyService.getRoles(userId);
    const isOpsOrStaff = roles.includes('ops_admin') || roles.includes('staff');

    const qb = this.supportTicketRepository.createQueryBuilder('t').where('t.deleted_at IS NULL');
    if (query.status) {
      qb.andWhere('t.status = :status', { status: query.status });
    }
    if (query.reservation_id) {
      qb.andWhere('t.reservation_id = :reservationId', { reservationId: query.reservation_id });
    }
    if (roles.includes('staff') && !roles.includes('ops_admin')) {
      const scopeIds = await this.scopePolicyService.getUserScopeIds(userId);
      if (scopeIds.length === 0) {
        qb.andWhere('1 = 0');
      } else {
        qb.andWhere(
          `EXISTS (
            SELECT 1
            FROM reservations r
            INNER JOIN reservation_data_scopes rds ON rds.reservation_id = r.id AND rds.deleted_at IS NULL
            WHERE r.id = t.reservation_id
              AND r.deleted_at IS NULL
              AND rds.scope_id IN (:...scopeIds)
          )`,
          { scopeIds }
        );
      }
    } else if (!isOpsOrStaff) {
      qb.andWhere('t.owner_user_id = :ownerId', { ownerId: userId });
    }

    qb.orderBy('t.created_at', 'DESC').addOrderBy('t.id', 'DESC');
    qb.skip((query.page - 1) * query.page_size).take(query.page_size);

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((item) => ({
        ...this.mapSupportTicket(item)
      })),
      page: query.page,
      page_size: query.page_size,
      total
    };
  }

  private async getSupportTicketOrThrow(ticketId: string): Promise<SupportTicketEntity> {
    const ticket = await this.supportTicketRepository.findOne({ where: { id: ticketId, deletedAt: IsNull() } });
    if (!ticket) {
      throw new AppException('NOT_FOUND', 'Support ticket not found', { ticket_id: ticketId }, 404);
    }

    return ticket;
  }

  private mapSupportTicket(ticket: SupportTicketEntity): Record<string, unknown> {
    return {
      ticket_id: ticket.id,
      reservation_id: ticket.reservationId,
      status: ticket.status,
      category: ticket.category,
      description: ticket.description,
      message_id: ticket.messageId,
      created_at: ticket.createdAt.toISOString(),
      updated_at: ticket.updatedAt.toISOString(),
      version: ticket.version
    };
  }
}
