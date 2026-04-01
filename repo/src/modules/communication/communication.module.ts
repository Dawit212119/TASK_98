import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ReservationModule } from '../reservation/reservation.module';
import { TrustRatingModule } from '../trust-rating/trust-rating.module';
import { CommunicationController } from './communication.controller';
import { CommunicationService } from './communication.service';
import { SensitiveWordService } from './sensitive-word.service';
import { NotificationService } from './notification.service';
import { SupportTicketService } from './support-ticket.service';
import { MessageReadEntity } from './entities/message-read.entity';
import { MessageEntity } from './entities/message.entity';
import { NotificationEntity } from './entities/notification.entity';
import { SensitiveWordEntity } from './entities/sensitive-word.entity';
import { SupportTicketEntity } from './entities/support-ticket.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MessageEntity,
      MessageReadEntity,
      SupportTicketEntity,
      NotificationEntity,
      SensitiveWordEntity
    ]),
    AuthModule,
    AccessControlModule,
    ReservationModule,
    TrustRatingModule,
    AuditModule
  ],
  controllers: [CommunicationController],
  providers: [CommunicationService, SensitiveWordService, NotificationService, SupportTicketService],
  exports: [CommunicationService, SensitiveWordService, NotificationService, SupportTicketService]
})
export class CommunicationModule {}
