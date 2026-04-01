import { AppException } from '../src/common/exceptions/app.exception';
import { ReservationService } from '../src/modules/reservation/reservation.service';

describe('ReservationService listReservations scope', () => {
  const defaultQuery = { page: 1, page_size: 20, sort_by: 'created_at', sort_order: 'desc' as const };

  const createService = (roles: string[]) => {
    const andWhereCalls: Array<{ sql: string; params?: Record<string, unknown> }> = [];

    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn((sql: string, params?: Record<string, unknown>) => {
        andWhereCalls.push({ sql, params });
        return qb;
      }),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [[], 0])
    };

    const reservationRepository = {
      createQueryBuilder: jest.fn(() => qb)
    };

    const scopePolicyService = {
      getRoles: jest.fn(async () => roles),
      applyReservationScopeQuery: jest.fn(async (queryBuilder: any, userId: string, currentRoles: string[]) => {
        const hasOpsAdmin = currentRoles.includes('ops_admin');
        const hasStaff = currentRoles.includes('staff');
        const hasProvider = currentRoles.includes('provider');
        const hasPatient = currentRoles.includes('patient');

        if (hasOpsAdmin || hasStaff) {
          return;
        }

        if (hasProvider && hasPatient) {
          queryBuilder.andWhere('(r.patient_id = :listUserId OR r.provider_id = :listUserId)', { listUserId: userId });
          return;
        }

        if (hasProvider) {
          queryBuilder.andWhere('r.provider_id = :providerUserId', { providerUserId: userId });
          return;
        }

        if (hasPatient) {
          queryBuilder.andWhere('r.patient_id = :patientUserId', { patientUserId: userId });
        }
      })
    };

    const service = new ReservationService(
      { createQueryRunner: jest.fn() } as any,
      scopePolicyService as any,
      {} as any,
      reservationRepository as any,
      {} as any,
      {} as any
    );

    return { service, andWhereCalls, qb };
  };

  it('throws 403 for merchant-only role', async () => {
    const { service } = createService(['merchant']);
    await expect(service.listReservations('u1', defaultQuery as any)).rejects.toMatchObject({
      code: 'RESERVATION_LIST_FORBIDDEN'
    });
    await expect(service.listReservations('u1', defaultQuery as any)).rejects.toBeInstanceOf(AppException);
  });

  it('throws 403 for analytics_viewer-only role', async () => {
    const { service } = createService(['analytics_viewer']);
    await expect(service.listReservations('u1', defaultQuery as any)).rejects.toMatchObject({
      code: 'RESERVATION_LIST_FORBIDDEN'
    });
  });

  it('allows patient scope with patient_id constraint', async () => {
    const { service, andWhereCalls } = createService(['patient']);
    await service.listReservations('patient-uuid', defaultQuery as any);
    expect(andWhereCalls.some((c) => c.sql.includes('r.patient_id = :patientUserId'))).toBe(true);
    expect(andWhereCalls.find((c) => c.params?.patientUserId === 'patient-uuid')).toBeTruthy();
  });

  it('allows staff without patient_id scope constraint', async () => {
    const { service, andWhereCalls } = createService(['staff']);
    await service.listReservations('staff-uuid', defaultQuery as any);
    expect(andWhereCalls.some((c) => c.sql.includes('r.patient_id = :patientUserId'))).toBe(false);
    expect(andWhereCalls.some((c) => c.sql.includes('r.provider_id = :providerUserId'))).toBe(false);
  });

  it('allows ops_admin without row scope constraint', async () => {
    const { service, andWhereCalls } = createService(['ops_admin']);
    await service.listReservations('ops-uuid', defaultQuery as any);
    expect(andWhereCalls.some((c) => c.sql.includes('r.patient_id = :patientUserId'))).toBe(false);
    expect(andWhereCalls.some((c) => c.sql.includes('r.provider_id = :providerUserId'))).toBe(false);
  });

  it('scopes provider to provider_id', async () => {
    const { service, andWhereCalls } = createService(['provider']);
    await service.listReservations('prov-uuid', defaultQuery as any);
    expect(andWhereCalls.some((c) => c.sql.includes('r.provider_id = :providerUserId'))).toBe(true);
    expect(andWhereCalls.find((c) => c.params?.providerUserId === 'prov-uuid')).toBeTruthy();
  });

  it('scopes patient+provider to OR of patient_id and provider_id', async () => {
    const { service, andWhereCalls } = createService(['patient', 'provider']);
    await service.listReservations('dual-uuid', defaultQuery as any);
    expect(andWhereCalls.some((c) => c.sql.includes('(r.patient_id = :listUserId OR r.provider_id = :listUserId)'))).toBe(
      true
    );
  });

  it('merchant with patient may list own patient scope', async () => {
    const { service, andWhereCalls } = createService(['merchant', 'patient']);
    await service.listReservations('p-uuid', defaultQuery as any);
    expect(andWhereCalls.some((c) => c.sql.includes('r.patient_id = :patientUserId'))).toBe(true);
  });

  it('allows analytics_viewer combined with patient using patient row scope', async () => {
    const { service, andWhereCalls } = createService(['analytics_viewer', 'patient']);
    await service.listReservations('p-uuid', defaultQuery as any);
    expect(andWhereCalls.some((c) => c.sql.includes('r.patient_id = :patientUserId'))).toBe(true);
  });
});
