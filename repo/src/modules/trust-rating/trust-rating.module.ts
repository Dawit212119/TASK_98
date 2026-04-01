import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ReservationStateTransitionEntity } from '../reservation/entities/reservation-state-transition.entity';
import { ReservationEntity } from '../reservation/entities/reservation.entity';
import { ActivitySignalEntity } from './entities/activity-signal.entity';
import { AppealDecisionEntity } from './entities/appeal-decision.entity';
import { CreditTierEntity } from './entities/credit-tier.entity';
import { FraudFlagEntity } from './entities/fraud-flag.entity';
import { ReviewAppealEntity } from './entities/review-appeal.entity';
import { ReviewEntity } from './entities/review.entity';
import { CreditTierScheduler } from './credit-tier.scheduler';
import { TrustRatingController } from './trust-rating.controller';
import { TrustRatingService } from './trust-rating.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReservationEntity,
      ReservationStateTransitionEntity,
      ReviewEntity,
      ReviewAppealEntity,
      AppealDecisionEntity,
      CreditTierEntity,
      FraudFlagEntity,
      ActivitySignalEntity
    ]),
    AuthModule,
    AccessControlModule,
    AuditModule
  ],
  controllers: [TrustRatingController],
  providers: [TrustRatingService, CreditTierScheduler],
  exports: [TrustRatingService]
})
export class TrustRatingModule {}
