import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { NotificationEntity } from '../communication/entities/notification.entity';
import { WorkflowRequestEntity, WorkflowRequestStatus } from './entities/workflow-request.entity';

@Injectable()
export class WorkflowReminderService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(WorkflowReminderService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(WorkflowRequestEntity)
    private readonly requestRepository: Repository<WorkflowRequestEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    private readonly auditService: AuditService
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sendSlaReminders().catch((error: unknown) => {
        const now = new Date();
        const leadHoursRaw = this.configService.get<number>('WORKFLOW_REMINDER_LEAD_HOURS') ?? 2;
        const leadHours = Number.isFinite(leadHoursRaw) && leadHoursRaw > 0 ? leadHoursRaw : 2;
        const windowEnd = new Date(now.getTime() + leadHours * 60 * 60 * 1000);
        const details = this.toErrorDetails(error);

        this.logger.error(
          JSON.stringify({
            event: 'workflow_reminder_job_failed',
            job: 'workflow_sla_reminder',
            run_at: now.toISOString(),
            window_end: windowEnd.toISOString(),
            error_message: details.message,
            error_code: details.code
          })
        );
      });
    }, 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sendSlaReminders(): Promise<void> {
    const now = new Date();
    const leadHoursRaw = this.configService.get<number>('WORKFLOW_REMINDER_LEAD_HOURS') ?? 2;
    const leadHours = Number.isFinite(leadHoursRaw) && leadHoursRaw > 0 ? leadHoursRaw : 2;
    const leadMs = leadHours * 60 * 60 * 1000;
    const windowEnd = new Date(now.getTime() + leadMs);
    const cooldownEdge = new Date(now.getTime() - 60 * 60 * 1000);

    const pending = await this.requestRepository
      .createQueryBuilder('wr')
      .where('wr.deleted_at IS NULL')
      .andWhere('wr.status = :status', { status: WorkflowRequestStatus.PENDING })
      .andWhere('wr.deadline_at > :now', { now: now.toISOString() })
      .andWhere('wr.deadline_at <= :windowEnd', { windowEnd: windowEnd.toISOString() })
      .andWhere('(wr.last_reminder_at IS NULL OR wr.last_reminder_at < :cooldownEdge)', {
        cooldownEdge: cooldownEdge.toISOString()
      })
      .getMany();

    for (const request of pending) {
      await this.notificationRepository.save(
        this.notificationRepository.create({
          userId: request.requestedBy,
          type: 'workflow_sla_reminder',
          title: 'Workflow SLA deadline approaching',
          body: `Workflow request ${request.id} is approaching its SLA deadline.`,
          payload: {
            request_id: request.id,
            deadline_at: request.deadlineAt.toISOString()
          },
          readAt: null
        })
      );

      request.lastReminderAt = new Date();
      request.version += 1;
      await this.requestRepository.save(request);

      await this.auditService.appendLog({
        entityType: 'workflow_request',
        entityId: request.id,
        action: 'workflow.request.sla_reminder',
        actorId: null,
        payload: {
          requested_by: request.requestedBy,
          deadline_at: request.deadlineAt.toISOString()
        }
      });
    }
  }

  private toErrorDetails(error: unknown): { message: string; code: string } {
    if (error instanceof Error) {
      const withCode = error as Error & { code?: string };
      return {
        message: withCode.message,
        code: typeof withCode.code === 'string' && withCode.code.length > 0 ? withCode.code : 'UNKNOWN'
      };
    }

    if (typeof error === 'string' && error.length > 0) {
      return { message: error, code: 'UNKNOWN' };
    }

    return { message: 'Unknown reminder failure', code: 'UNKNOWN' };
  }
}
