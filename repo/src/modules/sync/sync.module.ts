import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationEntity } from '../communication/entities/notification.entity';
import { ReservationEntity } from '../reservation/entities/reservation.entity';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReservationEntity, NotificationEntity]),
    AuthModule,
    AccessControlModule
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService]
})
export class SyncModule {}
