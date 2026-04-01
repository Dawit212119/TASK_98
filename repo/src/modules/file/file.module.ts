import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ReservationModule } from '../reservation/reservation.module';
import { FileController } from './file.controller';
import { IdentityDocumentEntity } from './entities/identity-document.entity';
import { ReservationFileEntity } from './entities/reservation-file.entity';
import { FileService } from './file.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReservationFileEntity, IdentityDocumentEntity]),
    AuthModule,
    AccessControlModule,
    ReservationModule,
    AuditModule
  ],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService]
})
export class FileModule {}
