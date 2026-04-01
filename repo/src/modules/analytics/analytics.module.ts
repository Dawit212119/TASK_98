import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsEventService } from './analytics-event.service';
import { AnalyticsExperimentService } from './analytics-experiment.service';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsAssignmentEntity } from './entities/analytics-assignment.entity';
import { AnalyticsEventEntity } from './entities/analytics-event.entity';
import { AnalyticsExperimentEntity } from './entities/analytics-experiment.entity';
import { AnalyticsExportEntity } from './entities/analytics-export.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnalyticsExperimentEntity,
      AnalyticsAssignmentEntity,
      AnalyticsEventEntity,
      AnalyticsExportEntity
    ]),
    AuthModule,
    AccessControlModule,
    AuditModule
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsEventService, AnalyticsExperimentService, AnalyticsExportService],
  exports: [AnalyticsService, AnalyticsEventService, AnalyticsExperimentService, AnalyticsExportService]
})
export class AnalyticsModule {}
