import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { MessageEntity } from '../communication/entities/message.entity';
import { NotificationEntity } from '../communication/entities/notification.entity';
import { FollowUpPlanEntity } from '../follow-up/entities/follow-up-plan.entity';
import { FollowUpTaskEntity } from '../follow-up/entities/follow-up-task.entity';
import { ReservationEntity } from '../reservation/entities/reservation.entity';
import { ReviewEntity } from '../trust-rating/entities/review.entity';
import { WorkflowRequestEntity } from '../workflow/entities/workflow-request.entity';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReservationEntity,
      NotificationEntity,
      MessageEntity,
      FollowUpTaskEntity,
      FollowUpPlanEntity,
      WorkflowRequestEntity,
      ReviewEntity
    ]),
    AuthModule,
    AccessControlModule
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService]
})
export class SyncModule {}
