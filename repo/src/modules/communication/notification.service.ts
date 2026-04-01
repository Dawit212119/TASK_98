import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../audit/audit.service';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationListQueryDto } from './dto/notification-list-query.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { AccessControlService } from '../access-control/access-control.service';

@Injectable()
export class NotificationService {
  /**
   * DELIVERY STUB — notifications are persisted to the database only.
   * External delivery (push / email / WebSocket) requires a delivery adapter
   * to be wired into sendToUser() before production use.
   * The workflow-reminder scheduler and SLA-expiry notifications depend on this.
   */

  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly auditService: AuditService,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>
  ) {}

  async createNotification(userId: string, payload: CreateNotificationDto): Promise<Record<string, unknown>> {
    await this.requireOpsAdmin(userId);

    const notification = await this.notificationRepository.save(
      this.notificationRepository.create({
        userId: payload.user_id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        payload: payload.payload,
        readAt: null
      })
    );
    await this.sendToUser(notification);

    await this.auditService.appendLog({
      entityType: 'notification',
      entityId: notification.id,
      action: 'notification.create',
      actorId: userId,
      payload: {
        target_user_id: payload.user_id,
        type: payload.type
      }
    });

    return this.mapNotification(notification);
  }

  async listNotifications(userId: string, query: NotificationListQueryDto): Promise<Record<string, unknown>> {
    const qb = this.notificationRepository.createQueryBuilder('n').where('n.user_id = :userId', { userId });
    qb.andWhere('n.deleted_at IS NULL');

    if (query.read === 'true') {
      qb.andWhere('n.read_at IS NOT NULL');
    }
    if (query.read === 'false') {
      qb.andWhere('n.read_at IS NULL');
    }

    qb.orderBy('n.created_at', 'DESC').addOrderBy('n.id', 'DESC').skip((query.page - 1) * query.page_size).take(query.page_size);
    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((item) => this.mapNotification(item)),
      page: query.page,
      page_size: query.page_size,
      total
    };
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<Record<string, unknown>> {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, userId, deletedAt: IsNull() }
    });
    if (!notification) {
      throw new AppException('NOT_FOUND', 'Notification not found', { notification_id: notificationId }, 404);
    }

    notification.readAt = new Date();
    const saved = await this.notificationRepository.save(notification);
    await this.sendToUser(saved);
    return this.mapNotification(saved);
  }

  async notifyTicketOwner(
    ownerUserId: string,
    actorId: string,
    type: string,
    title: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    if (ownerUserId === actorId) {
      return;
    }

    const notification = await this.notificationRepository.save(
      this.notificationRepository.create({
        userId: ownerUserId,
        type,
        title,
        body: title,
        payload,
        readAt: null
      })
    );
    await this.sendToUser(notification);
  }

  private async sendToUser(_notification: NotificationEntity): Promise<void> {
    /* delivery adapter hook — wire in push / email / WebSocket adapter before production use */
  }

  private mapNotification(notification: NotificationEntity): Record<string, unknown> {
    return {
      notification_id: notification.id,
      user_id: notification.userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      payload: notification.payload,
      read: Boolean(notification.readAt),
      read_at: notification.readAt?.toISOString() ?? null,
      created_at: notification.createdAt.toISOString(),
      updated_at: notification.updatedAt.toISOString(),
      version: notification.version
    };
  }

  private async requireOpsAdmin(userId: string): Promise<void> {
    const roles = await this.accessControlService.getUserRoleNames(userId);
    if (!roles.includes('ops_admin')) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }
  }
}
