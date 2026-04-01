import { AppException } from '../src/common/exceptions/app.exception';
import { ReservationStatus } from '../src/modules/reservation/entities/reservation.entity';
import { SyncEntityType } from '../src/modules/sync/dto/sync-push.dto';
import { SyncService } from '../src/modules/sync/sync.service';

describe('SyncService', () => {
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

  const createService = () => {
    let reservation = { ...reservationBase };

    const reservationRepository = {
      findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => (id === reservation.id ? reservation : null)),
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
          if (clause.includes('r.provider_id = :providerUserId') && typeof params.providerUserId === 'string') {
            rows = rows.filter((row) => row.providerId === params.providerUserId);
          }
          if (clause.includes('(r.patient_id = :listUserId OR r.provider_id = :listUserId)') && typeof params.listUserId === 'string') {
            rows = rows.filter((row) => row.patientId === params.listUserId || row.providerId === params.listUserId);
          }
          if (clause.includes('r.version > :sinceVersion') && typeof params.sinceVersion === 'number') {
            rows = rows.filter((row) => row.version > (params.sinceVersion as number));
          }
          return qb;
        });
        qb.orderBy = jest.fn(() => qb);
        qb.addOrderBy = jest.fn(() => qb);
        qb.take = jest.fn(() => qb);
        qb.getMany = jest.fn(async () => rows);
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

    const scopePolicyService = {
      getRoles: jest.fn(async () => ['patient']),
      applyReservationScopeQuery: jest.fn(async (queryBuilder: any, userId: string, roles: string[]) => {
        if (roles.includes('ops_admin') || roles.includes('staff')) {
          return;
        }
        if (roles.includes('provider') && roles.includes('patient')) {
          queryBuilder.andWhere('(r.patient_id = :listUserId OR r.provider_id = :listUserId)', { listUserId: userId });
          return;
        }
        if (roles.includes('provider')) {
          queryBuilder.andWhere('r.provider_id = :providerUserId', { providerUserId: userId });
          return;
        }
        queryBuilder.andWhere('r.patient_id = :patientUserId', { patientUserId: userId });
      }),
      assertReservationInScope: jest.fn(async (userId: string, reservationEntity: { patientId?: string; providerId?: string }, roles: string[]) => {
        const isInScope =
          roles.includes('ops_admin') ||
          roles.includes('staff') ||
          (roles.includes('provider') && reservationEntity.providerId === userId) ||
          reservationEntity.patientId === userId;
        if (!isInScope) {
          throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
        }
      })
    };

    const service = new SyncService(scopePolicyService as any, reservationRepository as any, notificationRepository as any);
    return { service };
  };

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

  it('pushChanges rejects non-reservation entity type at reservation handler', async () => {
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
