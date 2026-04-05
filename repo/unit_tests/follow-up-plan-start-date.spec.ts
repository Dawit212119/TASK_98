import { FollowUpService } from '../src/modules/follow-up/follow-up.service';

describe('FollowUpService createPlan start_date normalization', () => {
  const createService = () => {
    const accessControlService = {
      getUserRoleNames: jest.fn(async () => ['provider'])
    };

    const scopePolicyService = {
      getRoles: jest.fn(async () => ['provider']),
      assertReservationInScope: jest.fn(async () => undefined),
      getUserScopeIds: jest.fn(async () => [])
    };

    const auditService = {
      appendLog: jest.fn(async () => ({ id: 'audit-1' }))
    };

    const reservationRepository = {
      findOne: jest.fn(async () => ({ id: 'res-1', patientId: 'patient-1', deletedAt: null }))
    };

    const tagRepository = {
      create: jest.fn(),
      save: jest.fn()
    };

    const templateRepository = {
      findOne: jest.fn(async () => ({
        id: 'tmpl-1',
        active: true,
        deletedAt: null,
        taskRules: [{ task_name: 'BP check-in', every_n_days: 14, occurrences: 2 }]
      }))
    };

    const planRepository = {
      create: jest.fn((payload: unknown) => payload),
      findOne: jest.fn()
    };

    const taskRepository = {
      create: jest.fn((payload: unknown) => payload),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn()
    };

    const outcomeRepository = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn()
    };

    const manager = {
      save: jest.fn(async (_entity: unknown, payload: unknown) => {
        if (Array.isArray(payload)) {
          return payload.map((task, index) => ({
            ...(task as Record<string, unknown>),
            id: `task-${index + 1}`,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            version: 1,
            deletedAt: null
          }));
        }

        return {
          ...(payload as Record<string, unknown>),
          id: 'plan-1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          version: 1,
          deletedAt: null
        };
      })
    };

    const queryRunner = {
      manager,
      connect: jest.fn(async () => undefined),
      startTransaction: jest.fn(async () => undefined),
      commitTransaction: jest.fn(async () => undefined),
      rollbackTransaction: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined)
    };

    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner)
    };

    const service = new FollowUpService(
      dataSource as any,
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

    return { service, dataSource };
  };

  it('accepts ISO datetime start_date and normalizes to YYYY-MM-DD', async () => {
    const { service, dataSource } = createService();

    const result = await service.createPlan('provider-1', {
      patient_id: 'patient-1',
      reservation_id: 'res-1',
      template_id: 'tmpl-1',
      start_date: '2026-04-20T15:45:00.000Z'
    } as any);

    expect(result).toMatchObject({ plan_id: 'plan-1', start_date: '2026-04-20' });
    expect(Array.isArray(result.tasks)).toBe(true);
    expect((result.tasks as Array<Record<string, unknown>>)[0]?.due_at).toBe('2026-05-04T00:00:00.000Z');
    expect(dataSource.createQueryRunner).toHaveBeenCalled();
  });

  it('rejects invalid start_date values with validation error code', async () => {
    const { service } = createService();

    await expect(
      service.createPlan('provider-1', {
        patient_id: 'patient-1',
        reservation_id: 'res-1',
        template_id: 'tmpl-1',
        start_date: '2026-99-20T15:45:00.000Z'
      } as any)
    ).rejects.toMatchObject({ code: 'FOLLOW_UP_INVALID_START_DATE' });
  });
});
