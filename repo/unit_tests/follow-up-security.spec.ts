import { AppException } from '../src/common/exceptions/app.exception';
import { FollowUpService } from '../src/modules/follow-up/follow-up.service';
import { CommunicationService } from '../src/modules/communication/communication.service';

describe('FollowUpService security', () => {
  const createService = () => {
    const reservationRepository = {
      findOne: jest.fn()
    };
    const tagRepository = {
      create: jest.fn(),
      save: jest.fn()
    };
    const templateRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn()
    };
    const planRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn()
    };
    const taskRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn()
    };
    const outcomeRepository = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn()
    };

    const accessControlService = {
      getUserRoleNames: jest.fn()
    };
    const scopePolicyService = {
      getRoles: jest.fn(),
      assertReservationInScope: jest.fn(),
      getUserScopeIds: jest.fn()
    };
    const auditService = {
      appendLog: jest.fn()
    };

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

    return {
      service,
      accessControlService,
      scopePolicyService,
      reservationRepository,
      templateRepository,
      planRepository,
      taskRepository,
      outcomeRepository
    };
  };

  it('denies out-of-scope standalone plan read by id', async () => {
    const { service, planRepository, scopePolicyService } = createService();
    planRepository.findOne.mockResolvedValue({
      id: 'plan-1',
      patientId: 'patient-a',
      reservationId: null,
      templateId: 'tmpl-1',
      startDate: '2026-04-20',
      status: 'ACTIVE',
      createdBy: 'provider-a',
      version: 1
    });
    scopePolicyService.getRoles.mockResolvedValue(['provider']);

    await expect(service.getPlanById('provider-b', 'plan-1')).rejects.toMatchObject({ code: 'FORBIDDEN' } as AppException);
  });

  it('allows standalone plan read for creator', async () => {
    const { service, planRepository, taskRepository, scopePolicyService } = createService();
    planRepository.findOne.mockResolvedValue({
      id: 'plan-1',
      patientId: 'patient-a',
      reservationId: null,
      templateId: 'tmpl-1',
      startDate: '2026-04-20',
      status: 'ACTIVE',
      createdBy: 'provider-a',
      version: 1
    });
    taskRepository.find.mockResolvedValue([]);
    scopePolicyService.getRoles.mockResolvedValue(['provider']);

    const result = await service.getPlanById('provider-a', 'plan-1');
    expect(result).toMatchObject({ plan_id: 'plan-1' });
  });

  it('denies task outcome mutation when reservation scope cannot be verified', async () => {
    const { service, accessControlService, scopePolicyService, taskRepository, planRepository, reservationRepository } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['provider']);
    scopePolicyService.getRoles.mockResolvedValue(['provider']);
    taskRepository.findOne.mockResolvedValue({ id: 'task-1', planId: 'plan-1', status: 'PENDING', version: 1 });
    planRepository.findOne.mockResolvedValue({
      id: 'plan-1',
      patientId: 'patient-a',
      reservationId: 'res-1',
      createdBy: 'provider-a'
    });
    reservationRepository.findOne.mockResolvedValue(null);

    await expect(
      service.recordTaskOutcome('provider-a', 'task-1', {
        status: 'DONE',
        adherence_score: 95,
        outcome_payload: {}
      } as any)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' } as AppException);
  });

  it('rejects plan creation when patient_id mismatches reservation patient', async () => {
    const { service, accessControlService, scopePolicyService, reservationRepository, templateRepository } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['provider']);
    scopePolicyService.getRoles.mockResolvedValue(['provider']);
    reservationRepository.findOne.mockResolvedValue({ id: 'res-1', patientId: 'patient-a' });
    templateRepository.findOne.mockResolvedValue({ id: 'tmpl-1', taskRules: [], active: true });

    await expect(
      service.createPlan('provider-a', {
        patient_id: 'patient-b',
        reservation_id: 'res-1',
        template_id: 'tmpl-1',
        start_date: '2026-04-20'
      } as any)
    ).rejects.toMatchObject({ code: 'FOLLOW_UP_PATIENT_MISMATCH' } as AppException);
  });

  it('allows adherence metrics for analytics_viewer read scope', async () => {
    const { service, accessControlService, scopePolicyService, outcomeRepository } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['analytics_viewer']);
    scopePolicyService.getRoles.mockResolvedValue(['analytics_viewer']);

    const clauses: string[] = [];
    const qb: any = {
      innerJoin: jest.fn(() => qb),
      leftJoin: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn((sql: string) => {
        clauses.push(sql);
        return qb;
      }),
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      groupBy: jest.fn(() => qb),
      getRawMany: jest.fn(async () => [{ status: 'DONE', count: '1', avg_adherence: '91.0' }])
    };
    outcomeRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.getAdherenceMetrics('analytics-only', {} as any);

    expect(result).toMatchObject({ total_outcomes: 1 });
    expect(clauses.some((sql) => sql.includes('p.id IS NOT NULL'))).toBe(true);
  });

  it('rejects adherence metrics for unauthorized role', async () => {
    const { service, accessControlService } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['merchant']);

    await expect(service.getAdherenceMetrics('merchant-only', {} as any)).rejects.toMatchObject({ code: 'FORBIDDEN' } as AppException);
  });

  it('applies provider scope filter for adherence metrics', async () => {
    const { service, accessControlService, scopePolicyService, outcomeRepository } = createService();
    accessControlService.getUserRoleNames.mockResolvedValue(['provider']);
    scopePolicyService.getRoles.mockResolvedValue(['provider']);

    const clauses: string[] = [];
    const qb: any = {
      innerJoin: jest.fn(() => qb),
      leftJoin: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn((sql: string) => {
        clauses.push(sql);
        return qb;
      }),
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      groupBy: jest.fn(() => qb),
      getRawMany: jest.fn(async () => [{ status: 'DONE', count: '2', avg_adherence: '88.5' }])
    };
    outcomeRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.getAdherenceMetrics('provider-a', {} as any);
    expect(result).toMatchObject({ total_outcomes: 2 });
    expect(clauses.some((sql) => sql.includes('r.provider_id = :scopeUserId'))).toBe(true);
  });
});

describe('CommunicationService sensitive word admin auth', () => {
  const createService = (roles: string[]) => {
    const accessControlService = { getUserRoleNames: jest.fn(async () => roles) };
    const sensitiveWordRepository = {
      findOne: jest.fn(async () => null),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          andWhere: jest.fn(() => qb),
          orderBy: jest.fn(() => qb),
          addOrderBy: jest.fn(() => qb),
          getMany: jest.fn(async () => [
            {
              id: 'word-1',
              word: 'hate',
              active: true,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z')
            }
          ])
        };
        return qb;
      }),
      create: jest.fn((payload: Record<string, unknown>) => payload),
      save: jest.fn(async (payload: Record<string, unknown>) => ({
        id: 'word-1',
        word: payload.word,
        active: payload.active ?? true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z')
      }))
    };
    const auditService = { appendLog: jest.fn(async () => ({ id: 'audit-1' })) };

    // Use SensitiveWordService for sensitive word tests
    const SensitiveWordService = require('../src/modules/communication/sensitive-word.service').SensitiveWordService;

    const service = new SensitiveWordService(
      {} as any, // configService
      accessControlService as any,
      auditService as any,
      sensitiveWordRepository as any
    );

    return { service, auditService, sensitiveWordRepository };
  };

  it('forbids non-ops user from creating sensitive words', async () => {
    const { service } = createService(['staff']);
    await expect(service.createSensitiveWord('user-1', { word: 'hate' })).rejects.toMatchObject({ code: 'FORBIDDEN' } as AppException);
  });

  it('allows ops_admin to create sensitive words and audits action', async () => {
    const { service, auditService } = createService(['ops_admin']);
    const result = await service.createSensitiveWord('ops-1', { word: 'hate' });
    expect(result).toMatchObject({ word: 'hate', active: true });
    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sensitive_word.create', actorId: 'ops-1' })
    );
  });

  it('forbids non-ops user from listing/updating/toggling sensitive words', async () => {
    const { service, sensitiveWordRepository } = createService(['staff']);
    sensitiveWordRepository.findOne.mockResolvedValue({
      id: 'word-1',
      word: 'hate',
      active: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z')
    } as any);
    await expect(service.listSensitiveWords('user-1', {})).rejects.toMatchObject({ code: 'FORBIDDEN' } as AppException);
    await expect(service.updateSensitiveWord('user-1', 'word-1', { word: 'abuse' })).rejects.toMatchObject({
      code: 'FORBIDDEN'
    } as AppException);
    await expect(service.toggleSensitiveWord('user-1', 'word-1', { active: 'false' })).rejects.toMatchObject({
      code: 'FORBIDDEN'
    } as AppException);
  });
});
