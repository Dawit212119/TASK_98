import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditRetentionRunEntity } from './audit-retention-run.entity';
import { AuditRetentionService } from './audit-retention.service';
import { AuditLogEntity } from './audit-log.entity';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity, AuditRetentionRunEntity])],
  providers: [AuditService, AuditRetentionService],
  exports: [AuditService, AuditRetentionService]
})
export class AuditModule {}
