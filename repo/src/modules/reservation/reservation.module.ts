import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';
import { ReservationNoteEntity } from './entities/reservation-note.entity';
import { ReservationEntity } from './entities/reservation.entity';
import { ReservationStateTransitionEntity } from './entities/reservation-state-transition.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReservationEntity, ReservationStateTransitionEntity, ReservationNoteEntity]),
    AuthModule,
    AccessControlModule,
    AuditModule
  ],
  controllers: [ReservationController],
  providers: [ReservationService],
  exports: [ReservationService]
})
export class ReservationModule {}
