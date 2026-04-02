import { AppException } from '../src/common/exceptions/app.exception';
import { FollowUpTaskStatus } from '../src/modules/follow-up/entities/follow-up-task.entity';
import { ReservationStatus } from '../src/modules/reservation/entities/reservation.entity';
import { SyncEntityType } from '../src/modules/sync/dto/sync-push.dto';
import { SyncService } from '../src/modules/sync/sync.service';

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const reservationBase = {
  id: 'f96a13e0-8af2-40e7-ac71-3c9a19a1b103',
  patientId: 'user-1',
  providerId: 'provider-1',
  status: ReservationStatus.CONFIRMED,
  startTime: new Date('2026-03-28T10:00:00.000Z'),
  endTime: new Date('2026-03-28T11:00:00.000Z'),
  version: 3,
  updatedAt: new Date('2026-03-28T09:00:00.000Z'),
  deletedAt: null
};

const followUpPlanBase = {
  id: 'plan-0000-0000-0000-000000000001',
  patientId: 'user-1',
  reservationId: null,
  createdBy: 'provider-1',
  deletedAt: null
};

const followUpTaskBase = {
  id: 'task-1111-0000-0000-000000000001',
  planId: followUpPlanBase.id,
  taskName: 'Follow-up call',
  ruleType: 'days' as const,
  ruleValue: 7,
  sequenceNo: 1,
  dueAt: new Date('2026-04-04T00:00:00.000Z'),
  nextDueAt: null,
  status: FollowUpTaskStatus.PENDING,
  version: 1,
  updatedAt: new Date('2026-03-28T09:00:00.000Z'),
  deletedAt: null
};

// ─── Service factory ──────────────────────────────────────────────────────────

const createService = (overrides: {
  reservationOverride?: Partial<typeof reservationBase>;
  followUpTaskOverride?: Partial<typeof followUpTaskBase>;
  followUpPlanOverride?: Partial<typeof followUpPlanBase>;
  roles?: string[];
  scopeIds?: string[];
} = {}) => {
  let reservation = { ...reservationBase, ...overrides.reservationOverride };
  let task = { ...followUpTaskBase, ...overrides.followUpTaskOverride };
  const plan = { ...followUpPlanBase, ...overrides.followUpPlanOverride };

  const reservationRepository = {
    findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) =>
      id === reservation.id ? { ...reservation } : null
    ),
    save: jest.fn(async (entity: typeof reservation) => {
      reservation = { ...entity };
      return reservation;
    }),
    createQueryBuilder: jest.fn(() => {
      let rows = [{ ...reservation }];
      const qb: any = {};
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn((clause: string, params: Record<string, unknown>) => {
        if (clause.includes('r.patient_id = :patientUserId') && typeof params.patientUserId === 'string') {
          rows = rows.filter((row) => row.patientId === params.patientUserId);
        }
        if (clause.includes('r.version > :sinceVersion') && typeof params.sinceVersion === 'number') {
          rows = rows.filter((row) => row.version > (params.sinceVersion as number));
        }
        return qb;
      });
      qb.orderBy = jest.fn(() => qb);
      qb.addOrderBy = jest.fn(() => qb);
      qb.take = jest.fn(() => qb);
      qb.select = jest.fn(() => qb);
      qb.getMany = jest.fn(async () => rows);
      qb.getRawMany = jest.fn(async () => rows.map((r) => ({ id: r.id })));
      return qb;
    })
  };

  const notificationRepository = {
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.orderBy = jest.fn(() => qb);
      qb.addOrderBy = jest.fn(() => qb);
      qb.take = jest.fn(() => qb);
      qb.getMany = jest.fn(async () => []);
      return qb;
    })
  };

  const messageRepository = {
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.orderBy = jest.fn(() => qb);
      qb.addOrderBy = jest.fn(() => qb);
      qb.take = jest.fn(() => qb);
      qb.getMany = jest.fn(async () => []);
      return qb;
    })
  };

  const followUpTaskRepository = {
    findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) =>
      id === task.id ? { ...task } : null
    ),
    save: jest.fn(async (entity: typeof task) => {
      task = { ...entity };
      return task;
    }),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.orderBy = jest.fn(() => qb);
      qb.addOrderBy = jest.fn(() => qb);
      qb.take = jest.fn(() => qb);
      qb.getMany = jest.fn(async () => [{ ...task }]);
      return qb;
    })
  };

  const followUpPlanRepository = {
    findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) =>
      id === plan.id ? { ...plan } : null
    ),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.setParameter = jest.fn(() => qb);
      qb.select = jest.fn(() => qb);
      qb.orderBy = jest.fn(() => qb);
      qb.addOrderBy = jest.fn(() => qb);
      qb.take = jest.fn(() => qb);
      qb.getMany = jest.fn(async () => [{ ...plan }]);
      qb.getRawMany = jest.fn(async () => [{ id: plan.id }]);
      return qb;
    })
  };

  const workflowRequestRepository = {
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.orderBy = jest.fn(() => qb);
      qb.addOrderBy = jest.fn(() => qb);
      qb.take = jest.fn(() => qb);
      qb.getMany = jest.fn(async () => []);
      return qb;
    })
  };

  const reviewRepository = {
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.orderBy = jest.fn(() => qb);
      qb.addOrderBy = jest.fn(() => qb);
      qb.take = jest.fn(() => qb);
      qb.getMany = jest.fn(async () => []);
      return qb;
    })
  };

  const roles = overrides.roles ?? ['patient'];

  const scopePolicyService = {
    getRoles: jest.fn(async () => roles),
    getUserScopeIds: jest.fn(async () => overrides.scopeIds ?? []),
    applyReservationScopeQuery: jest.fn(async (queryBuilder: any, userId: string, roleList: string[]) => {
      if (roleList.includes('ops_admin') || roleList.includes('staff')) return;
      if (roleList.includes('patient')) {
        queryBuilder.andWhere('r.patient_id = :patientUserId', { patientUserId: userId });
      }
    }),
    assertReservationInScope: jest.fn(async (userId: string, res: { patientId?: string; providerId?: string }, roleList: string[]) => {
      const ok =
        roleList.includes('ops_admin') ||
        roleList.includes('staff') ||
        (roleList.includes('provider') && res.providerId === userId) ||
        res.patientId === userId;
      if (!ok) throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    })
  };

  const service = new SyncService(
    scopePolicyService as any,
    reservationRepository as any,
    notificationRepository as any,
    messageRepository as any,
    followUpTaskRepository as any,
    followUpPlanRepository as any,
    workflowRequestRepository as any,
    reviewRepository as any
  );

  return { service, followUpTaskRepository, followUpPlanRepository };
};

// ─── Existing reservation tests (unchanged behavior) ─────────────────────────

describe('SyncService — reservation (existing behavior)', () => {
  it('returns conflict item when base_version mismatches', async () => {
    const { service } = createService();

    const result = await service.pushChanges('user-1', {
      client_id: 'mobile-1',
      changes: [
        {
          entity_type: 'reservation',
          entity_id: 'f96a13e0-8af2-40e7-ac71-3c9a19a1b103',
          operation: 'UPSERT',
          payload: {
            start_time: '2026-03-28T12:00:00.000Z',
            end_time: '2026-03-28T13:00:00.000Z'
          },
          base_version: 2,
          updated_at: '2026-03-28T11:59:00.000Z'
        }
      ]
    });

    expect(result).toEqual({
      accepted: [],
      conflicts: [
        {
          entity_id: 'f96a13e0-8af2-40e7-ac71-3c9a19a1b103',
          server_version: 3,
          reason: 'SYNC_VERSION_CONFLICT'
        }
      ]
    });
  });

  it('throws 422 on unknown entity type', async () => {
    const { service } = createService();

    await expect(
      service.pushChanges('user-1', {
        client_id: 'mobile-1',
        changes: [
          {
            entity_type: 'unknown_entity',
            entity_id: 'f96a13e0-8af2-40e7-ac71-3c9a19a1b103',
            operation: 'UPSERT',
            payload: {},
            base_version: 1,
            updated_at: '2026-03-28T11:59:00.000Z'
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'SYNC_ENTITY_NOT_SUPPORTED' } as AppException);
  });

  it('throws 422 when pull cursor is missing', async () => {
    const { service } = createService();

    await expect(
      service.pullChanges('user-1', {
        page: 1,
        page_size: 10,
        entity_types: [SyncEntityType.RESERVATION]
      })
    ).rejects.toMatchObject({ code: 'SYNC_CURSOR_REQUIRED' } as AppException);
  });

  it('returns pull rows with tombstone marker', async () => {
    const { service } = createService();

    const result = await service.pullChanges('user-1', {
      since_version: 1,
      entity_types: [SyncEntityType.RESERVATION],
      page: 1,
      page_size: 10
    });

    expect(result).toMatchObject({ page: 1, page_size: 10, total: 1 });
    expect(Array.isArray(result.changes)).toBe(true);
    expect((result.changes as Array<Record<string, unknown>>)[0]).toMatchObject({
      entity_type: 'reservation',
      entity_id: 'f96a13e0-8af2-40e7-ac71-3c9a19a1b103',
      version: 3,
      tombstone: false
    });
  });

  it('pushChanges forbids patient updating another users reservation', async () => {
    const { service } = createService();

    await expect(
      service.pushChanges('other-patient', {
        client_id: 'mobile-1',
        changes: [
          {
            entity_type: 'reservation',
            entity_id: 'f96a13e0-8af2-40e7-ac71-3c9a19a1b103',
            operation: 'UPSERT',
            payload: {
              start_time: '2026-03-28T12:00:00.000Z',
              end_time: '2026-03-28T13:00:00.000Z'
            },
            base_version: 3,
            updated_at: '2026-03-28T11:59:00.000Z'
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' } as AppException);
  });

  it('pushChanges rejects notification push (not supported)', async () => {
    const { service } = createService();

    await expect(
      service.pushChanges('user-1', {
        client_id: 'mobile-1',
        changes: [
          {
            entity_type: 'notification',
            entity_id: 'f96a13e0-8af2-40e7-ac71-3c9a19a1b103',
            operation: 'UPSERT',
            payload: {},
            base_version: 1,
            updated_at: '2026-03-28T11:59:00.000Z'
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'SYNC_ENTITY_PUSH_NOT_SUPPORTED' } as AppException);
  });
});

// ─── follow_up_task push ──────────────────────────────────────────────────────

describe('SyncService — follow_up_task push', () => {
  it('patient marks their own task DONE (accepted)', async () => {
    const { service } = createService({ roles: ['patient'] });

    const result = await service.pushChanges('user-1', {
      client_id: 'mobile-1',
      changes: [
        {
          entity_type: 'follow_up_task',
          entity_id: followUpTaskBase.id,
          operation: 'UPSERT',
          payload: { status: 'DONE' },
          base_version: 1,
          updated_at: '2026-04-01T10:00:00.000Z'
        }
      ]
    });

    expect(result).toMatchObject({
      conflicts: [],
      accepted: [
        expect.objectContaining({
          entity_type: SyncEntityType.FOLLOW_UP_TASK,
          entity_id: followUpTaskBase.id
        })
      ]
    });
  });

  it('returns version conflict when base_version mismatches task', async () => {
    const { service } = createService({ roles: ['patient'] });

    const result = await service.pushChanges('user-1', {
      client_id: 'mobile-1',
      changes: [
        {
          entity_type: 'follow_up_task',
          entity_id: followUpTaskBase.id,
          operation: 'UPSERT',
          payload: { status: 'DONE' },
          base_version: 99,   // wrong version
          updated_at: '2026-04-01T10:00:00.000Z'
        }
      ]
    });

    expect(result).toMatchObject({
      accepted: [],
      conflicts: [
        expect.objectContaining({
          entity_id: followUpTaskBase.id,
          reason: 'SYNC_VERSION_CONFLICT'
        })
      ]
    });
  });

  it('forbids a caller who does not own the plan and is not staff/ops_admin', async () => {
    const { service } = createService({ roles: ['patient'] });

    await expect(
      service.pushChanges('unrelated-user', {
        client_id: 'mobile-1',
        changes: [
          {
            entity_type: 'follow_up_task',
            entity_id: followUpTaskBase.id,
            operation: 'UPSERT',
            payload: { status: 'DONE' },
            base_version: 1,
            updated_at: '2026-04-01T10:00:00.000Z'
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' } as AppException);
  });

  it('rejects invalid task status value', async () => {
    const { service } = createService({ roles: ['patient'] });

    await expect(
      service.pushChanges('user-1', {
        client_id: 'mobile-1',
        changes: [
          {
            entity_type: 'follow_up_task',
            entity_id: followUpTaskBase.id,
            operation: 'UPSERT',
            payload: { status: 'CANCELLED' },   // not a patient-pushable status
            base_version: 1,
            updated_at: '2026-04-01T10:00:00.000Z'
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'SYNC_INVALID_PAYLOAD' } as AppException);
  });

  it('rejects push of review entity type (pull-only)', async () => {
    const { service } = createService({ roles: ['patient'] });

    await expect(
      service.pushChanges('user-1', {
        client_id: 'mobile-1',
        changes: [
          {
            entity_type: 'review',
            entity_id: 'some-review-id',
            operation: 'UPSERT',
            payload: {},
            base_version: 1,
            updated_at: '2026-04-01T10:00:00.000Z'
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'SYNC_ENTITY_PUSH_NOT_SUPPORTED' } as AppException);
  });
});

// ─── New entity types — pull ──────────────────────────────────────────────────

describe('SyncService — new entity pull (follow_up_task, workflow_request, review, message)', () => {
  it('pull returns follow_up_task entries for the patient', async () => {
    const { service } = createService({ roles: ['patient'] });

    const result = await service.pullChanges('user-1', {
      since_updated_at: '2020-01-01T00:00:00.000Z',
      entity_types: [SyncEntityType.FOLLOW_UP_TASK],
      page: 1,
      page_size: 10
    });

    expect(result.total).toBeGreaterThanOrEqual(1);
    const changes = result.changes as Array<Record<string, unknown>>;
    expect(changes[0]).toMatchObject({ entity_type: SyncEntityType.FOLLOW_UP_TASK });
  });

  it('pull returns empty array for workflow_request when user has no requests', async () => {
    const { service } = createService({ roles: ['patient'] });

    const result = await service.pullChanges('user-1', {
      since_updated_at: '2020-01-01T00:00:00.000Z',
      entity_types: [SyncEntityType.WORKFLOW_REQUEST],
      page: 1,
      page_size: 10
    });

    expect(result.total).toBe(0);
    expect(result.changes).toEqual([]);
  });

  it('pull handles multiple entity types in one request', async () => {
    const { service } = createService({ roles: ['patient'] });

    const result = await service.pullChanges('user-1', {
      since_updated_at: '2020-01-01T00:00:00.000Z',
      entity_types: [SyncEntityType.NOTIFICATION, SyncEntityType.REVIEW],
      page: 1,
      page_size: 20
    });

    // Both types are valid and produce no errors.
    expect(Array.isArray(result.changes)).toBe(true);
  });
});
