import { FollowUpService } from '../src/modules/follow-up/follow-up.service';

describe('FollowUpService privileged audit – getAdherenceMetrics', () => {
  const createService = () => {
    const reservationRepository = { findOne: jest.fn() };
    const tagRepository = { create: jest.fn(), save: jest.fn() };
    const templateRepository = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    const planRepository = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    const taskRepository = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    const outcomeRepository = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn()
    };

    const accessControlService = { getUserRoleNames: jest.fn() };
    const scopePolicyService = {
      getRoles: jest.fn(),
      assertReservationInScope: jest.fn(),
      getUserScopeIds: jest.fn()
    };
    const auditService = { appendLog: jest.fn(async () => ({ id: 'audit-1' })) };

    const service = new FollowUpService(
      { createQueryRunner: jest.fn() } as any,
      accessControlService as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      tagRepository as any,
      templateRepository as any,
      planRepository as any,
      taskRepository as any,
      outcomeRepository as any
    );

    return { service, accessControlService, scopePolicyService, auditService, outcomeRepository };
  };

  const buildQb = (rows: Array<{ status: string; count: string; avg_adherence: string }>) => {
    const qb: any = {
      innerJoin: jest.fn(() => qb),
      leftJoin: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      setParameter: jest.fn(() => qb),
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      groupBy: jest.fn(() => qb),
      getRawMany: jest.fn(async () => rows)
    };
    return qb;
  };

  it('emits privileged audit record on successful adherence read (ops_admin)', async () => {
    const { service, accessControlService, scopePolicyService, auditService, outcomeRepository } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['ops_admin']);
    scopePolicyService.getRoles.mockResolvedValue(['ops_admin']);
    outcomeRepository.createQueryBuilder.mockReturnValue(
      buildQb([{ status: 'DONE', count: '5', avg_adherence: '90.0' }])
    );

    await service.getAdherenceMetrics('admin-1', { patient_id: 'p-1' } as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'follow_up.adherence.read',
        actorId: 'admin-1',
        entityType: 'follow_up_adherence',
        entityId: null,
        payload: expect.objectContaining({
          access_basis: 'ops_admin',
          outcome: 'success',
          filters: expect.objectContaining({ patient_id: 'p-1' })
        })
      })
    );
  });

  it('emits privileged audit record with provider access basis', async () => {
    const { service, accessControlService, scopePolicyService, auditService, outcomeRepository } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['provider']);
    scopePolicyService.getRoles.mockResolvedValue(['provider']);
    outcomeRepository.createQueryBuilder.mockReturnValue(
      buildQb([{ status: 'DONE', count: '2', avg_adherence: '88.0' }])
    );

    await service.getAdherenceMetrics('provider-1', {} as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'follow_up.adherence.read',
        actorId: 'provider-1',
        payload: expect.objectContaining({
          access_basis: 'provider',
          outcome: 'success',
          filters: {}
        })
      })
    );
  });

  it('emits privileged audit record with staff access basis', async () => {
    const { service, accessControlService, scopePolicyService, auditService, outcomeRepository } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['staff']);
    scopePolicyService.getRoles.mockResolvedValue(['staff']);
    scopePolicyService.getUserScopeIds.mockResolvedValue(['scope-1']);
    outcomeRepository.createQueryBuilder.mockReturnValue(
      buildQb([{ status: 'MISSED', count: '1', avg_adherence: '50.0' }])
    );

    await service.getAdherenceMetrics('staff-1', { from: '2026-01-01', to: '2026-01-31' } as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          access_basis: 'staff',
          filters: expect.objectContaining({ from: '2026-01-01', to: '2026-01-31' })
        })
      })
    );
  });

  it('emits privileged audit record with analytics_viewer access basis', async () => {
    const { service, accessControlService, scopePolicyService, auditService, outcomeRepository } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['analytics_viewer']);
    scopePolicyService.getRoles.mockResolvedValue(['analytics_viewer']);
    outcomeRepository.createQueryBuilder.mockReturnValue(
      buildQb([{ status: 'DONE', count: '3', avg_adherence: '80.0' }])
    );

    await service.getAdherenceMetrics('viewer-1', {} as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ access_basis: 'analytics_viewer' })
      })
    );
  });

  it('does NOT emit audit record when role check fails (unauthorized)', async () => {
    const { service, accessControlService, auditService } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['merchant']);

    await expect(service.getAdherenceMetrics('merchant-1', {} as any)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(auditService.appendLog).not.toHaveBeenCalled();
  });
});

describe('FollowUpService privileged audit – getPlanById', () => {
  it('emits privileged read audit on successful getPlanById', async () => {
    const plan = {
      id: 'plan-read-1',
      patientId: 'patient-a',
      reservationId: null as string | null,
      templateId: 'tmpl-1',
      startDate: '2026-04-20',
      status: 'ACTIVE',
      createdBy: 'provider-a',
      version: 1,
      deletedAt: null
    };

    const planRepository = {
      findOne: jest.fn().mockResolvedValue(plan),
      create: jest.fn(),
      save: jest.fn()
    };
    const taskRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn()
    };
    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['provider']),
      assertReservationInScope: jest.fn(),
      getUserScopeIds: jest.fn()
    };
    const accessControlService = { getUserRoleNames: jest.fn() };
    const auditService = { appendLog: jest.fn(async () => ({ id: 'audit-1' })) };

    const service = new FollowUpService(
      { createQueryRunner: jest.fn() } as any,
      accessControlService as any,
      scopePolicyService as any,
      auditService as any,
      { findOne: jest.fn() } as any,
      { create: jest.fn(), save: jest.fn() } as any,
      { findOne: jest.fn(), create: jest.fn(), save: jest.fn() } as any,
      planRepository as any,
      taskRepository as any,
      { create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() } as any
    );

    await service.getPlanById('provider-a', 'plan-read-1');

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'follow_up.plan.read',
        actorId: 'provider-a',
        entityType: 'follow_up_plan',
        entityId: 'plan-read-1',
        payload: expect.objectContaining({
          access_basis: 'provider',
          outcome: 'success',
          filters: expect.objectContaining({ plan_id: 'plan-read-1', patient_id: 'patient-a' })
        })
      })
    );
  });
});
