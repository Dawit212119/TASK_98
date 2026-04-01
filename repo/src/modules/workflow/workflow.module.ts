import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationEntity } from '../communication/entities/notification.entity';
import { WorkflowController } from './workflow.controller';
import { WorkflowBusinessTimeService } from './workflow-business-time.service';
import { WorkflowReminderService } from './workflow-reminder.service';
import { WorkflowService } from './workflow.service';
import { WorkflowApprovalEntity } from './entities/workflow-approval.entity';
import { WorkflowDefinitionEntity } from './entities/workflow-definition.entity';
import { WorkflowRequestEntity } from './entities/workflow-request.entity';
import { WorkflowStepEntity } from './entities/workflow-step.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowDefinitionEntity,
      WorkflowStepEntity,
      WorkflowRequestEntity,
      WorkflowApprovalEntity,
      NotificationEntity
    ]),
    AuthModule,
    AccessControlModule,
    AuditModule
  ],
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowReminderService, WorkflowBusinessTimeService],
  exports: [WorkflowService]
})
export class WorkflowModule {}
