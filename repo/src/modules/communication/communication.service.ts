import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { ReservationService } from '../reservation/reservation.service';
import { TrustRatingService } from '../trust-rating/trust-rating.service';
import { MarkMessagesReadDto } from './dto/mark-messages-read.dto';
import { MessageListQueryDto } from './dto/message-list-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageEntity } from './entities/message.entity';
import { MessageReadEntity } from './entities/message-read.entity';
import { SensitiveWordService } from './sensitive-word.service';

const CHAT_RATE_LIMIT_PER_MINUTE = 20;

@Injectable()
export class CommunicationService {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly trustRatingService: TrustRatingService,
    private readonly sensitiveWordService: SensitiveWordService,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    @InjectRepository(MessageReadEntity)
    private readonly messageReadRepository: Repository<MessageReadEntity>
  ) {}

  async postMessage(
    userId: string,
    reservationId: string,
    payload: SendMessageDto,
    context: { ipAddress?: string | null; deviceId?: string | null }
  ): Promise<Record<string, unknown>> {
    await this.reservationService.ensureReservationForAttachment(userId, reservationId);
    await this.enforceMessageRateLimit(userId);
    await this.sensitiveWordService.enforceSensitiveWords(payload.content);

    const message = await this.messageRepository.save(
      this.messageRepository.create({
        reservationId,
        senderId: userId,
        content: payload.content
      })
    );

    await this.trustRatingService.recordActivitySignal({
      userId,
      actionType: 'chat_message',
      ipAddress: context.ipAddress ?? null,
      deviceId: context.deviceId ?? null
    });

    return this.mapMessage(message);
  }

  async listMessages(userId: string, reservationId: string, query: MessageListQueryDto): Promise<Record<string, unknown>> {
    await this.reservationService.ensureReservationForAttachment(userId, reservationId);

    const qb = this.messageRepository.createQueryBuilder('m').where('m.reservation_id = :reservationId', { reservationId });
    qb.andWhere('m.deleted_at IS NULL');

    if (query.since) {
      qb.andWhere('m.created_at >= :since', { since: query.since });
    }

    qb.orderBy('m.created_at', 'ASC').addOrderBy('m.id', 'ASC');
    qb.skip((query.page - 1) * query.page_size).take(query.page_size);

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((item) => this.mapMessage(item)),
      page: query.page,
      page_size: query.page_size,
      total
    };
  }

  async markMessagesRead(userId: string, reservationId: string, payload: MarkMessagesReadDto): Promise<Record<string, unknown>> {
    await this.reservationService.ensureReservationForAttachment(userId, reservationId);

    if (!payload.last_read_message_id && !payload.last_read_at) {
      throw new AppException('CHAT_READ_CURSOR_REQUIRED', 'last_read_message_id or last_read_at is required', {}, 422);
    }

    if (payload.last_read_message_id) {
      const exists = await this.messageRepository.findOne({
        where: { id: payload.last_read_message_id, reservationId, deletedAt: IsNull() }
      });
      if (!exists) {
        throw new AppException('NOT_FOUND', 'Message not found', { message_id: payload.last_read_message_id }, 404);
      }
    }

    const existing = await this.messageReadRepository.findOne({ where: { reservationId, userId, deletedAt: IsNull() } });
    const entity = existing ?? this.messageReadRepository.create({ reservationId, userId });
    entity.lastReadMessageId = payload.last_read_message_id ?? entity.lastReadMessageId ?? null;
    entity.lastReadAt = payload.last_read_at ? new Date(payload.last_read_at) : entity.lastReadAt ?? new Date();
    const saved = await this.messageReadRepository.save(entity);

    return {
      reservation_id: saved.reservationId,
      user_id: saved.userId,
      last_read_message_id: saved.lastReadMessageId,
      last_read_at: saved.lastReadAt?.toISOString() ?? null,
      version: saved.version
    };
  }


  private async enforceMessageRateLimit(userId: string): Promise<void> {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const count = await this.messageRepository
      .createQueryBuilder('m')
      .where('m.sender_id = :senderId', { senderId: userId })
      .andWhere('m.created_at >= :oneMinuteAgo', { oneMinuteAgo: oneMinuteAgo.toISOString() })
      .getCount();

    if (count >= CHAT_RATE_LIMIT_PER_MINUTE) {
      throw new AppException('CHAT_RATE_LIMIT_EXCEEDED', 'Message rate limit exceeded', {}, 429);
    }
  }

  private mapMessage(message: MessageEntity): Record<string, unknown> {
    return {
      message_id: message.id,
      reservation_id: message.reservationId,
      sender_id: message.senderId,
      content: message.content,
      created_at: message.createdAt.toISOString(),
      updated_at: message.updatedAt.toISOString(),
      version: message.version
    };
  }
}
