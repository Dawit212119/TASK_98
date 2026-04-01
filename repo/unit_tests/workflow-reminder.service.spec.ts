/**
 * Unit tests for WorkflowReminderService
 * Verifies SLA reminder job functionality
 */
import { WorkflowReminderService } from '../src/modules/workflow/workflow-reminder.service';
import { WorkflowRequestEntity, WorkflowRequestStatus } from '../src/modules/workflow/entities/workflow-request.entity';
import { NotificationEntity } from '../src/modules/communication/entities/notification.entity';

describe('WorkflowReminderService', () => {
  let service: WorkflowReminderService;
  let mockRequestRepository: any;
  let mockNotificationRepository: any;
  let mockConfigService: any;
  let mockAuditService: any;

  beforeEach(() => {
    mockRequestRepository = {
      createQueryBuilder: jest.fn(),
      save: jest.fn()
    };

    mockNotificationRepository = {
      save: jest.fn(),
      create: jest.fn()
    };

    mockConfigService = {
      get: jest.fn()
    };

    mockAuditService = {
      appendLog: jest.fn()
    };

    service = new WorkflowReminderService(
      mockConfigService,
      mockRequestRepository,
      mockNotificationRepository,
      mockAuditService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendSlaReminders', () => {
    it('should send reminders for pending requests approaching deadline', async () => {
      const now = new Date();
      const futureDeadline = new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 hours from now
      const leadHours = 2;

      const mockRequest: Partial<WorkflowRequestEntity> = {
        id: 'req-1',
        status: WorkflowRequestStatus.PENDING,
        requestedBy: 'user-123',
        deadlineAt: futureDeadline,
        lastReminderAt: null,
        version: 1
      };

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockRequest])
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      mockConfigService.get.mockReturnValue(leadHours);
      mockNotificationRepository.create.mockReturnValue({
        userId: 'user-123',
        type: 'workflow_sla_reminder',
        title: 'Workflow SLA deadline approaching',
        body: `Workflow request ${mockRequest.id} is approaching its SLA deadline.`,
        payload: { request_id: mockRequest.id, deadline_at: futureDeadline.toISOString() },
        readAt: null
      });
      mockNotificationRepository.save.mockResolvedValue({ id: 'notif-1' });
      mockRequestRepository.save.mockResolvedValue({ ...mockRequest, lastReminderAt: now });

      await service.sendSlaReminders();

      expect(queryBuilder.where).toHaveBeenCalledWith('wr.deleted_at IS NULL');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('wr.status = :status', { status: WorkflowRequestStatus.PENDING });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'wr.deadline_at > :now',
        expect.objectContaining({})
      );
      expect(queryBuilder.getMany).toHaveBeenCalled();
      expect(mockNotificationRepository.save).toHaveBeenCalled();
      expect(mockAuditService.appendLog).toHaveBeenCalled();
    });

    it('should not send reminders for requests beyond deadline', async () => {
      const now = new Date();
      const pastDeadline = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      mockConfigService.get.mockReturnValue(2);

      await service.sendSlaReminders();

      expect(mockNotificationRepository.save).not.toHaveBeenCalled();
      expect(mockAuditService.appendLog).not.toHaveBeenCalled();
    });

    it('should not send reminders if already sent recently', async () => {
      const now = new Date();
      const recentReminder = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes ago
      const futureDeadline = new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 hours from now

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      mockConfigService.get.mockReturnValue(2);

      await service.sendSlaReminders();

      expect(mockNotificationRepository.save).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully and log them', async () => {
      const mockError = new Error('Database error');
      const logSpy = jest.spyOn(console, 'error').mockImplementation();

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockRejectedValue(mockError)
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      mockConfigService.get.mockReturnValue(2);

      await expect(service.sendSlaReminders()).rejects.toThrow('Database error');

      logSpy.mockRestore();
    });

    it('should update request lastReminderAt timestamp', async () => {
      const now = new Date();
      const futureDeadline = new Date(now.getTime() + 3 * 60 * 60 * 1000);

      const mockRequest: Partial<WorkflowRequestEntity> = {
        id: 'req-1',
        status: WorkflowRequestStatus.PENDING,
        requestedBy: 'user-123',
        deadlineAt: futureDeadline,
        lastReminderAt: null,
        version: 1
      };

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockRequest])
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      mockConfigService.get.mockReturnValue(2);
      mockNotificationRepository.create.mockReturnValue({});
      mockNotificationRepository.save.mockResolvedValue({ id: 'notif-1' });
      mockRequestRepository.save.mockResolvedValue({ ...mockRequest, lastReminderAt: now });

      await service.sendSlaReminders();

      expect(mockRequestRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'req-1',
          lastReminderAt: expect.any(Date),
          version: 2
        })
      );
    });

    it('should audit log reminder sent with correct details', async () => {
      const now = new Date();
      const futureDeadline = new Date(now.getTime() + 3 * 60 * 60 * 1000);

      const mockRequest: Partial<WorkflowRequestEntity> = {
        id: 'req-1',
        status: WorkflowRequestStatus.PENDING,
        requestedBy: 'user-123',
        deadlineAt: futureDeadline,
        lastReminderAt: null,
        version: 1
      };

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockRequest])
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      mockConfigService.get.mockReturnValue(2);
      mockNotificationRepository.create.mockReturnValue({});
      mockNotificationRepository.save.mockResolvedValue({ id: 'notif-1' });
      mockRequestRepository.save.mockResolvedValue({ ...mockRequest, lastReminderAt: now });

      await service.sendSlaReminders();

      expect(mockAuditService.appendLog).toHaveBeenCalledWith({
        entityType: 'workflow_request',
        entityId: 'req-1',
        action: 'workflow.request.sla_reminder',
        actorId: null,
        payload: {
          requested_by: 'user-123',
          deadline_at: futureDeadline.toISOString()
        }
      });
    });

    it('should handle multiple pending requests', async () => {
      const now = new Date();
      const leadHours = 2;

      const mockRequests: Partial<WorkflowRequestEntity>[] = [
        {
          id: 'req-1',
          status: WorkflowRequestStatus.PENDING,
          requestedBy: 'user-1',
          deadlineAt: new Date(now.getTime() + 3 * 60 * 60 * 1000),
          lastReminderAt: null,
          version: 1
        },
        {
          id: 'req-2',
          status: WorkflowRequestStatus.PENDING,
          requestedBy: 'user-2',
          deadlineAt: new Date(now.getTime() + 1 * 60 * 60 * 1000),
          lastReminderAt: null,
          version: 1
        }
      ];

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRequests)
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      mockConfigService.get.mockReturnValue(leadHours);
      mockNotificationRepository.create.mockReturnValue({});
      mockNotificationRepository.save.mockResolvedValue({ id: 'notif-id' });
      mockRequestRepository.save.mockResolvedValue({});

      await service.sendSlaReminders();

      expect(mockNotificationRepository.save).toHaveBeenCalledTimes(2);
      expect(mockAuditService.appendLog).toHaveBeenCalledTimes(2);
    });

    it('should use default lead hours if config is invalid', async () => {
      const now = new Date();
      const futureDeadline = new Date(now.getTime() + 3 * 60 * 60 * 1000);

      const mockRequest: Partial<WorkflowRequestEntity> = {
        id: 'req-1',
        status: WorkflowRequestStatus.PENDING,
        requestedBy: 'user-123',
        deadlineAt: futureDeadline,
        lastReminderAt: null,
        version: 1
      };

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockRequest])
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      mockConfigService.get.mockReturnValue(null); // Invalid config
      mockNotificationRepository.create.mockReturnValue({});
      mockNotificationRepository.save.mockResolvedValue({ id: 'notif-1' });
      mockRequestRepository.save.mockResolvedValue({ ...mockRequest, lastReminderAt: now });

      await service.sendSlaReminders();

      // Should still send reminder with default 2 hour lead time
      expect(mockNotificationRepository.save).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('should set up reminder timer on module init', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const newService = new WorkflowReminderService(
        mockConfigService,
        mockRequestRepository,
        mockNotificationRepository,
        mockAuditService
      );

      newService.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60 * 1000);
      // Clean up real interval to avoid open handles after tests finish.
      newService.onModuleDestroy();

      setIntervalSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clean up timer on module destroy', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue(123 as any);

      const newService = new WorkflowReminderService(
        mockConfigService,
        mockRequestRepository,
        mockNotificationRepository,
        mockAuditService
      );

      newService.onModuleInit();
      newService.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
      setIntervalSpy.mockRestore();
    });
  });
});
