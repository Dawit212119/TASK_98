import { WorkflowService } from '../src/modules/workflow/workflow.service';
import { WorkflowApprovalEntity } from '../src/modules/workflow/entities/workflow-approval.entity';
import { WorkflowApprovalMode } from '../src/modules/workflow/entities/workflow-definition.entity';
import { WorkflowRequestStatus } from '../src/modules/workflow/entities/workflow-request.entity';

describe('WorkflowService privileged audit — approve / reject', () => {
  const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const definitionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const staffUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  const baseRequest = () => ({
    id: requestId,
    workflowDefinitionId: definitionId,
    resourceType: 'reservation',
    resourceRef: 'res-1',
    payload: {},
    status: WorkflowRequestStatus.PENDING,
    currentStepOrder: 1,
    requestedBy: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    deadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    lastReminderAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    deletedAt: null
  });

  const stepRow = {
    id: 'step-1',
    workflowDefinitionId: definitionId,
    order: 1,
    approverRole: 'staff',
    conditions: {},
    deletedAt: null
  };

  const buildApproveMocks = () => {
    const request = baseRequest();
    const savedApprovals: Array<Record<string, unknown>> = [];

    const manager = {
      findOne: jest.fn(async () => ({ ...request })),
      save: jest.fn(async (_Ctor: unknown, entity: Record<string, unknown>) => {
        if (entity && entity.action === 'APPROVE') {
          savedApprovals.push({
            workflowRequestId: entity.workflowRequestId,
            stepOrder: entity.stepOrder,
            approverUserId: entity.approverUserId,
            action: entity.action,
            deletedAt: null
          });
        }
        return entity;
      }),
      getRepository: (entity: unknown) => {
        if (entity === WorkflowApprovalEntity) {
          return {
            find: jest.fn(async () => savedApprovals.map((a) => ({ ...a })))
          };
        }
        return { find: jest.fn(async () => []) };
      }
    };

    const qr = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager
    };

    const requestRepository = {
      findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => (id === requestId ? { ...request } : null)),
      save: jest.fn()
    };

    const definitionRepository = {
      findOne: jest.fn(async () => ({
        id: definitionId,
        approvalMode: WorkflowApprovalMode.ANY_ONE,
        slaHours: 48,
        active: true,
        deletedAt: null
      }))
    };

    const stepRepository = {
      find: jest.fn(async () => [stepRow])
    };

    const approvalRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((x: unknown) => x)
    };

    const accessControlService = {
      getUserRoleNames: jest.fn(async (uid: string) => (uid === staffUserId ? ['staff'] : []))
    };

    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };

    const workflowBusinessTimeService = { calculateDeadlineAt: jest.fn() };

    const dataSource = { createQueryRunner: jest.fn(() => qr) };

    const service = new WorkflowService(
      dataSource as any,
      accessControlService as any,
      workflowBusinessTimeService as any,
      auditService as any,
      definitionRepository as any,
      stepRepository as any,
      requestRepository as any,
      approvalRepository as any
    );

    return { service, auditService };
  };

  it('approveRequest emits standardized privileged audit (access_basis, filters, outcome)', async () => {
    const { service, auditService } = buildApproveMocks();

    await service.approveRequest(staffUserId, requestId, { comment: 'ok' });

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.request.approve',
        actorId: staffUserId,
        entityType: 'workflow_request',
        entityId: requestId,
        payload: expect.objectContaining({
          access_basis: 'staff',
          outcome: 'success',
          filters: expect.objectContaining({
            request_id: requestId,
            workflow_definition_id: definitionId
          })
        })
      })
    );
  });

  const buildRejectMocks = () => {
    const request = baseRequest();
    const qr = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOne: jest.fn(async () => ({ ...request })),
        save: jest.fn(async (_Ctor: unknown, entity: Record<string, unknown>) => entity)
      }
    };

    const requestRepository = {
      findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => (id === requestId ? { ...request } : null)),
      save: jest.fn()
    };

    const definitionRepository = {
      findOne: jest.fn(async () => ({
        id: definitionId,
        approvalMode: WorkflowApprovalMode.ANY_ONE,
        slaHours: 48,
        active: true,
        deletedAt: null
      }))
    };

    const stepRepository = {
      find: jest.fn(async () => [stepRow])
    };

    const approvalRepository = {
      create: jest.fn((x: unknown) => x)
    };

    const accessControlService = {
      getUserRoleNames: jest.fn(async (uid: string) => (uid === staffUserId ? ['staff'] : []))
    };

    const auditService = { appendLog: jest.fn(async () => ({ id: 'a2' })) };
    const workflowBusinessTimeService = { calculateDeadlineAt: jest.fn() };
    const dataSource = { createQueryRunner: jest.fn(() => qr) };

    const service = new WorkflowService(
      dataSource as any,
      accessControlService as any,
      workflowBusinessTimeService as any,
      auditService as any,
      definitionRepository as any,
      stepRepository as any,
      requestRepository as any,
      approvalRepository as any
    );

    return { service, auditService };
  };

  it('rejectRequest emits standardized privileged audit (access_basis, filters, outcome)', async () => {
    const { service, auditService } = buildRejectMocks();

    await service.rejectRequest(staffUserId, requestId, { reason: 'no budget' });

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.request.reject',
        actorId: staffUserId,
        entityType: 'workflow_request',
        entityId: requestId,
        payload: expect.objectContaining({
          access_basis: 'staff',
          outcome: 'success',
          filters: expect.objectContaining({
            request_id: requestId,
            workflow_definition_id: definitionId
          }),
          reason: 'no budget'
        })
      })
    );
  });
});
