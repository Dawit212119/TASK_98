import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { CommunicationService } from './communication.service';
import { SensitiveWordService } from './sensitive-word.service';
import { NotificationService } from './notification.service';
import { SupportTicketService } from './support-ticket.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { MarkMessagesReadDto } from './dto/mark-messages-read.dto';
import { MessageListQueryDto } from './dto/message-list-query.dto';
import { NotificationListQueryDto } from './dto/notification-list-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  CloseSupportTicketDto,
  CreateSensitiveWordDto,
  EscalateSupportTicketDto,
  ResolveSupportTicketDto,
  SensitiveWordListQueryDto,
  ToggleSensitiveWordDto,
  UpdateSensitiveWordDto
} from './dto/support-ticket-action.dto';
import { SupportTicketListQueryDto } from './dto/support-ticket-list-query.dto';

@Controller()
@UseGuards(JwtAuthGuard)
@ApiTags('Communication')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient role or out-of-scope communication resource' })
export class CommunicationController {
  constructor(
    private readonly communicationService: CommunicationService,
    private readonly sensitiveWordService: SensitiveWordService,
    private readonly notificationService: NotificationService,
    private readonly supportTicketService: SupportTicketService
  ) {}

  @Post('reservations/:reservation_id/messages')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string,
    @Body() payload: SendMessageDto,
    @Ip() ipAddress: string,
    @Headers('x-device-id') deviceId?: string
  ): Promise<Record<string, unknown>> {
    return this.communicationService.postMessage(user.userId, reservationId, payload, { ipAddress, deviceId: deviceId ?? null });
  }

  @Get('reservations/:reservation_id/messages')
  @HttpCode(HttpStatus.OK)
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string,
    @Query() query: MessageListQueryDto
  ): Promise<Record<string, unknown>> {
    return this.communicationService.listMessages(user.userId, reservationId, query);
  }

  @Post('reservations/:reservation_id/messages/read')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  markMessagesRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string,
    @Body() payload: MarkMessagesReadDto
  ): Promise<Record<string, unknown>> {
    return this.communicationService.markMessagesRead(user.userId, reservationId, payload);
  }

  @Post('support/tickets')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createSupportTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreateSupportTicketDto
  ): Promise<Record<string, unknown>> {
    return this.supportTicketService.createSupportTicket(user.userId, payload);
  }

  @Get('support/tickets')
  @HttpCode(HttpStatus.OK)
  listSupportTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SupportTicketListQueryDto
  ): Promise<Record<string, unknown>> {
    return this.supportTicketService.listSupportTickets(user.userId, query);
  }

  @Post('support/tickets/:ticket_id/escalate')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  escalateSupportTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ticket_id') ticketId: string,
    @Body() payload: EscalateSupportTicketDto
  ): Promise<Record<string, unknown>> {
    return this.supportTicketService.escalateSupportTicket(user.userId, ticketId, payload);
  }

  @Post('support/tickets/:ticket_id/resolve')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  resolveSupportTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ticket_id') ticketId: string,
    @Body() payload: ResolveSupportTicketDto
  ): Promise<Record<string, unknown>> {
    return this.supportTicketService.resolveSupportTicket(user.userId, ticketId, payload);
  }

  @Post('support/tickets/:ticket_id/close')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  closeSupportTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ticket_id') ticketId: string,
    @Body() payload: CloseSupportTicketDto
  ): Promise<Record<string, unknown>> {
    return this.supportTicketService.closeSupportTicket(user.userId, ticketId, payload);
  }

  @Post('notifications')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createNotification(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreateNotificationDto
  ): Promise<Record<string, unknown>> {
    return this.notificationService.createNotification(user.userId, payload);
  }

  @Get('notifications')
  @HttpCode(HttpStatus.OK)
  listNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationListQueryDto
  ): Promise<Record<string, unknown>> {
    return this.notificationService.listNotifications(user.userId, query);
  }

  @Post('notifications/:notification_id/read')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  markNotificationRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notification_id') notificationId: string
  ): Promise<Record<string, unknown>> {
    return this.notificationService.markNotificationRead(user.userId, notificationId);
  }

  @Post('sensitive-words')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createSensitiveWord(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreateSensitiveWordDto
  ): Promise<Record<string, unknown>> {
    return this.sensitiveWordService.createSensitiveWord(user.userId, payload);
  }

  @Get('sensitive-words')
  @HttpCode(HttpStatus.OK)
  listSensitiveWords(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SensitiveWordListQueryDto
  ): Promise<Record<string, unknown>> {
    return this.sensitiveWordService.listSensitiveWords(user.userId, query);
  }

  @Post('sensitive-words/:word_id/update')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  updateSensitiveWord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('word_id') wordId: string,
    @Body() payload: UpdateSensitiveWordDto
  ): Promise<Record<string, unknown>> {
    return this.sensitiveWordService.updateSensitiveWord(user.userId, wordId, payload);
  }

  @Post('sensitive-words/:word_id/toggle')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  toggleSensitiveWord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('word_id') wordId: string,
    @Body() payload: ToggleSensitiveWordDto
  ): Promise<Record<string, unknown>> {
    return this.sensitiveWordService.toggleSensitiveWord(user.userId, wordId, payload);
  }
}
