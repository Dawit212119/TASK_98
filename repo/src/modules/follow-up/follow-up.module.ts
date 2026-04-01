import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ReservationModule } from '../reservation/reservation.module';
import { FollowUpController } from './follow-up.controller';
import { FollowUpService } from './follow-up.service';
import { FollowUpOutcomeEntity } from './entities/follow-up-outcome.entity';
import { FollowUpPlanEntity } from './entities/follow-up-plan.entity';
import { FollowUpPlanTemplateEntity } from './entities/follow-up-plan-template.entity';
import { FollowUpTagEntity } from './entities/follow-up-tag.entity';
import { FollowUpTaskEntity } from './entities/follow-up-task.entity';
import { ReservationEntity } from '../reservation/entities/reservation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FollowUpTagEntity,
      FollowUpPlanTemplateEntity,
      FollowUpPlanEntity,
      FollowUpTaskEntity,
      FollowUpOutcomeEntity,
      ReservationEntity
    ]),
    AuthModule,
    AccessControlModule,
    ReservationModule,
    AuditModule
  ],
  controllers: [FollowUpController],
  providers: [FollowUpService],
  exports: [FollowUpService]
})
export class FollowUpModule {}
