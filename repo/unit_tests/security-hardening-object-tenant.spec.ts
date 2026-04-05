/**
 * Security Hardening — Object-level Authorization & Tenant/User Data Isolation
 *
 * Tests that:
 * B) Object-level authorization is consistent — analytics_viewer cannot access unrestricted data.
 * D) Tenant/user data isolation — scoped queries prevent cross-user/cross-scope leakage.
 *    Includes table-driven tests for role combinations and negative cross-scope tests.
 */

import { AppException } from '../src/common/exceptions/app.exception';

/* ─── Follow-up adherence metrics — analytics_viewer scope restriction (B, D) ─ */

describe('FollowUpService — adherence metrics analytics_viewer scope (B, D)', () => {
  const { FollowUpService } = require('../src/modules/follow-up/follow-up.service');

  const buildService = (
    opts: {
      roles?: string[];
      scopeIds?: string[];
      queryBuilderClauses?: string[];
    } = {}
  ) => {
    const roles = opts.roles ?? ['analytics_viewer'];
    const capturedClauses: string[] = opts.queryBuilderClauses ?? [];
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const accessControlService = {
      getUserRoleNames: jest.fn(async () => roles),
    };
    const scopePolicyService = {
      getRoles: jest.fn(async () => roles),
      getUserScopeIds: jest.fn(async () => opts.scopeIds ?? []),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined),
    };

    const outcomeRepository = {
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        qb.innerJoin = jest.fn(() => qb);
        qb.leftJoin = jest.fn(() => qb);
        qb.where = jest.fn(() => qb);
        qb.andWhere = jest.fn((clause: string) => {
          capturedClauses.push(clause);
          return qb;
        });
        qb.setParameter = jest.fn(() => qb);
        qb.select = jest.fn(() => qb);
        qb.addSelect = jest.fn(() => qb);
        qb.groupBy = jest.fn(() => qb);
        qb.getRawMany = jest.fn(async () => []);
        return qb;
      }),
    };

    const service = new FollowUpService(
      {} as any, // dataSource
      accessControlService as any,
      scopePolicyService as any,
      auditService as any,
      {} as any, // reservationRepository
      {} as any, // tagRepository
      {} as any, // templateRepository
      {} as any, // planRepository
      {} as any, // taskRepository
      outcomeRepository as any,
    );

    return { service, auditService, capturedClauses };
  };

  it('analytics_viewer query does NOT contain "p.id IS NOT NULL" (unrestricted access removed)', async () => {
    const clauses: string[] = [];
    const { service } = buildService({ roles: ['analytics_viewer'], queryBuilderClauses: clauses });

    await service.getAdherenceMetrics('viewer-user', {});

    // The query clauses should NOT contain the always-true "p.id IS NOT NULL"
    const hasUnrestricted = clauses.some((c) => c.includes('p.id IS NOT NULL'));
    expect(hasUnrestricted).toBe(false);
  });

  it('analytics_viewer query restricts to plans created by the viewer', async () => {
    const clauses: string[] = [];
    const { service } = buildService({ roles: ['analytics_viewer'], queryBuilderClauses: clauses });

    await service.getAdherenceMetrics('viewer-user', {});

    // Should contain the created_by scope restriction
    const hasCreatedByRestriction = clauses.some((c) => c.includes('p.created_by = :scopeUserId'));
    expect(hasCreatedByRestriction).toBe(true);
  });

  it('ops_admin gets unrestricted adherence access (no scope clauses)', async () => {
    const clauses: string[] = [];
    const { service } = buildService({ roles: ['ops_admin'], queryBuilderClauses: clauses });

    await service.getAdherenceMetrics('admin-user', {});

    // ops_admin should NOT have scope clauses added
    const hasScopeClauses = clauses.some(
      (c) => c.includes('p.patient_id') || c.includes('p.created_by') || c.includes('p.id IS NOT NULL')
    );
    expect(hasScopeClauses).toBe(false);
  });

  // Table-driven: role combinations and expected scope behavior
  const roleScopeTable = [
    {
      roles: ['provider'],
      label: 'provider only',
      expectClause: 'r.provider_id = :scopeUserId',
      expectNoUnrestricted: true,
    },
    {
      roles: ['staff'],
      label: 'staff only',
      expectClause: 'p.created_by = :scopeUserId',
      expectNoUnrestricted: true,
    },
    {
      roles: ['analytics_viewer'],
      label: 'analytics_viewer only',
      expectClause: 'p.created_by = :scopeUserId',
      expectNoUnrestricted: true,
    },
    {
      roles: ['analytics_viewer', 'provider'],
      label: 'analytics_viewer + provider (dual role)',
      expectClause: 'r.provider_id = :scopeUserId',
      expectNoUnrestricted: true,
    },
  ];

  it.each(roleScopeTable)(
    '$label: restricts adherence data with scope clause',
    async ({ roles, expectClause, expectNoUnrestricted }) => {
      const clauses: string[] = [];
      const { service } = buildService({ roles, queryBuilderClauses: clauses });

      await service.getAdherenceMetrics('user-1', {});

      const combined = clauses.join(' ');
      expect(combined).toContain(expectClause);
      if (expectNoUnrestricted) {
        expect(combined).not.toContain('p.id IS NOT NULL');
      }
    }
  );

  // Negative: roles that should be DENIED entirely
  const deniedRoles = [
    { roles: ['merchant'], label: 'merchant only' },
  ];

  it.each(deniedRoles)(
    '$label: denied adherence access',
    async ({ roles }) => {
      const { service } = buildService({ roles });
      await expect(service.getAdherenceMetrics('user-1', {})).rejects.toThrow(AppException);
    }
  );
});

/* ─── Sync follow-up task isolation — merchant deny (D) ──────────── */

describe('SyncService — follow-up task merchant isolation (D, extended)', () => {
  const { SyncService } = require('../src/modules/sync/sync.service');
  const { FollowUpTaskStatus } = require('../src/modules/follow-up/entities/follow-up-task.entity');
  const { ReservationStatus } = require('../src/modules/reservation/entities/reservation.entity');

  const buildSyncService = (roles: string[], scopeIds: string[] = []) => {
    const followUpPlanBase = {
      id: 'plan-iso-0001',
      patientId: 'user-patient',
      reservationId: null,
      createdBy: 'provider-1',
      deletedAt: null,
    };
    const followUpTaskBase = {
      id: 'task-iso-0001',
      planId: followUpPlanBase.id,
      taskName: 'Test task',
      ruleType: 'days' as const,
      ruleValue: 7,
      sequenceNo: 1,
      dueAt: new Date('2026-04-04T00:00:00.000Z'),
      nextDueAt: null,
      status: FollowUpTaskStatus.PENDING,
      version: 1,
      updatedAt: new Date(),
      deletedAt: null,
    };

    const scopePolicyService = {
      getRoles: jest.fn(async () => roles),
      getUserScopeIds: jest.fn(async () => scopeIds),
      applyReservationScopeQuery: jest.fn(async () => {}),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined),
    };

    const followUpPlanRepository = {
      findOne: jest.fn(async () => followUpPlanBase),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        qb.where = jest.fn(() => qb);
        qb.andWhere = jest.fn(() => qb);
        qb.setParameter = jest.fn(() => qb);
        qb.select = jest.fn(() => qb);
        qb.getRawMany = jest.fn(async () => [{ id: followUpPlanBase.id }]);
        return qb;
      }),
    };

    const followUpTaskRepository = {
      findOne: jest.fn(async () => ({ ...followUpTaskBase })),
      save: jest.fn(async (e: any) => e),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        qb.where = jest.fn(() => qb);
        qb.andWhere = jest.fn(() => qb);
        qb.orderBy = jest.fn(() => qb);
        qb.addOrderBy = jest.fn(() => qb);
        qb.take = jest.fn(() => qb);
        qb.getMany = jest.fn(async () => [{ ...followUpTaskBase }]);
        return qb;
      }),
    };

    const emptyQb = () => {
      const qb: any = {};
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.orderBy = jest.fn(() => qb);
      qb.addOrderBy = jest.fn(() => qb);
      qb.take = jest.fn(() => qb);
      qb.select = jest.fn(() => qb);
      qb.getMany = jest.fn(async () => []);
      qb.getRawMany = jest.fn(async () => []);
      return qb;
    };

    const reservationRepository = {
      findOne: jest.fn(async () => null),
      createQueryBuilder: jest.fn(() => emptyQb()),
    };

    const service = new SyncService(
      scopePolicyService as any,
      reservationRepository as any,
      { createQueryBuilder: jest.fn(() => emptyQb()) } as any,
      { createQueryBuilder: jest.fn(() => emptyQb()) } as any,
      followUpTaskRepository as any,
      followUpPlanRepository as any,
      { createQueryBuilder: jest.fn(() => emptyQb()) } as any,
      { createQueryBuilder: jest.fn(() => emptyQb()) } as any,
    );

    return { service };
  };

  // Table-driven: push merchant deny
  const pushDeniedRoles = [
    { roles: ['merchant'], label: 'merchant' },
    { roles: ['merchant', 'patient'], label: 'merchant+patient (dual role)' },
    { roles: ['merchant', 'staff'], label: 'merchant+staff (dual role)' },
  ];

  it.each(pushDeniedRoles)(
    'PUSH: $label is denied follow-up task sync',
    async ({ roles }) => {
      const { service } = buildSyncService(roles);
      await expect(
        service.pushChanges('user-merchant', {
          client_id: 'c1',
          changes: [{
            entity_type: 'follow_up_task',
            entity_id: 'task-iso-0001',
            operation: 'UPSERT',
            payload: { status: 'DONE' },
            base_version: 1,
            updated_at: new Date().toISOString(),
          }],
        })
      ).rejects.toThrow(AppException);
    }
  );

  // Table-driven: pull merchant deny
  const pullDeniedRoles = [
    { roles: ['merchant'], label: 'merchant' },
    { roles: ['merchant', 'patient'], label: 'merchant+patient (dual role)' },
  ];

  it.each(pullDeniedRoles)(
    'PULL: $label is denied follow-up task sync',
    async ({ roles }) => {
      const { service } = buildSyncService(roles);
      await expect(
        service.pullChanges('user-merchant', {
          entity_types: ['follow_up_task'],
          since_updated_at: '2020-01-01T00:00:00.000Z',
          page: 1,
          page_size: 10,
        })
      ).rejects.toThrow(AppException);
    }
  );

  // Positive: allowed roles
  const pullAllowedRoles = [
    { roles: ['patient'], label: 'patient' },
    { roles: ['staff'], label: 'staff', scopeIds: ['scope-1'] },
    { roles: ['ops_admin'], label: 'ops_admin' },
  ];

  it.each(pullAllowedRoles)(
    'PULL: $label is allowed follow-up task sync',
    async ({ roles, scopeIds }) => {
      const { service } = buildSyncService(roles, scopeIds);
      const result = await service.pullChanges('user-patient', {
        entity_types: ['follow_up_task'],
        since_updated_at: '2020-01-01T00:00:00.000Z',
        page: 1,
        page_size: 10,
      });
      expect(result).toBeDefined();
      expect(result.changes).toBeDefined();
    }
  );
});

/* ─── Cross-scope negative tests (D) ─────────────────────────────── */

describe('Reservation scope isolation — negative cross-scope tests (D)', () => {
  const { ReservationService } = require('../src/modules/reservation/reservation.service');
  const { ReservationStatus } = require('../src/modules/reservation/entities/reservation.entity');

  it('patient cannot read another patient\'s reservation', async () => {
    const reservation = {
      id: 'res-other',
      patientId: 'other-patient',
      providerId: 'provider-1',
      status: ReservationStatus.CONFIRMED,
      version: 1,
      deletedAt: null,
    };

    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['patient']),
      assertReservationInScope: jest.fn(async () => {
        throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
      }),
    };
    const reservationRepository = {
      findOne: jest.fn().mockResolvedValue(reservation),
    };

    const service = new ReservationService(
      {} as any,
      scopePolicyService as any,
      { appendLog: jest.fn() } as any,
      reservationRepository as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.getReservationById('attacker-patient', 'res-other')
    ).rejects.toThrow(AppException);

    try {
      await service.getReservationById('attacker-patient', 'res-other');
    } catch (err: any) {
      expect(err.status).toBe(403);
    }
  });

  it('patient cannot list another patient\'s reservations via scope filter', async () => {
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['patient']),
      applyReservationScopeQuery: jest.fn(async (qb: any, userId: string) => {
        qb.andWhere('r.patient_id = :patientUserId', { patientUserId: userId });
      }),
    };

    let capturedPatientIdParam: string | null = null;
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn((clause: string, params?: Record<string, unknown>) => {
        if (params?.patientUserId) capturedPatientIdParam = params.patientUserId as string;
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[], 0]),
    };

    const reservationRepository = {
      createQueryBuilder: jest.fn(() => qb),
    };

    const service = new ReservationService(
      {} as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      {} as any,
      {} as any,
    );

    await service.listReservations('patient-1', { page: 1, page_size: 10 });

    // Scope filter must be applied with the caller's own user ID
    expect(capturedPatientIdParam).toBe('patient-1');
    expect(scopePolicyService.applyReservationScopeQuery).toHaveBeenCalledWith(
      expect.anything(),
      'patient-1',
      ['patient']
    );
  });
});
