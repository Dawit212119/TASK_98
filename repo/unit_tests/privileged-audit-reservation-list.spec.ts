import { ReservationService } from '../src/modules/reservation/reservation.service';

describe('ReservationService listReservations privileged audit', () => {
  const defaultQuery = { page: 1, page_size: 20, sort_by: 'created_at', sort_order: 'desc' as const };

  const createService = (roles: string[]) => {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [[], 0])
    };

    const reservationRepository = { createQueryBuilder: jest.fn(() => qb) };
    const scopePolicyService = {
      getRoles: jest.fn(async () => roles),
      applyReservationScopeQuery: jest.fn()
    };
    const auditService = { appendLog: jest.fn(async () => ({ id: 'audit-1' })) };

    const service = new ReservationService(
      { createQueryRunner: jest.fn() } as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      {} as any,
      {} as any
    );

    return { service, auditService };
  };

  it('emits privileged audit record on successful reservation list (ops_admin)', async () => {
    const { service, auditService } = createService(['ops_admin']);

    await service.listReservations('admin-1', defaultQuery as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reservation.list',
        actorId: 'admin-1',
        entityType: 'reservation',
        entityId: null,
        payload: expect.objectContaining({
          access_basis: 'ops_admin',
          outcome: 'success',
          filters: expect.any(Object)
        })
      })
    );
  });

  it('emits privileged audit record with staff access basis', async () => {
    const { service, auditService } = createService(['staff']);

    await service.listReservations('staff-1', defaultQuery as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reservation.list',
        actorId: 'staff-1',
        payload: expect.objectContaining({ access_basis: 'staff' })
      })
    );
  });

  it('emits privileged audit record with provider access basis', async () => {
    const { service, auditService } = createService(['provider']);

    await service.listReservations('provider-1', defaultQuery as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ access_basis: 'provider' })
      })
    );
  });

  it('emits privileged audit record with self access basis for patient', async () => {
    const { service, auditService } = createService(['patient']);

    await service.listReservations('patient-1', defaultQuery as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ access_basis: 'self' })
      })
    );
  });

  it('emits privileged audit record with merchant access basis', async () => {
    const { service, auditService } = createService(['merchant']);

    await service.listReservations('merchant-1', defaultQuery as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          access_basis: 'merchant',
          outcome: 'success',
          filters: expect.any(Object)
        })
      })
    );
  });

  it('includes query filters in audit payload', async () => {
    const { service, auditService } = createService(['ops_admin']);

    await service.listReservations('admin-1', {
      ...defaultQuery,
      status: 'CONFIRMED',
      patient_id: 'p-1',
      from: '2026-01-01'
    } as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          access_basis: 'ops_admin',
          outcome: 'success',
          filters: expect.objectContaining({
            status: 'CONFIRMED',
            patient_id: 'p-1',
            from: '2026-01-01',
            result_total: 0
          })
        })
      })
    );
  });

  it('does NOT emit audit record when role check fails', async () => {
    const { service, auditService } = createService(['analytics_viewer']);

    await expect(service.listReservations('viewer-1', defaultQuery as any)).rejects.toMatchObject({
      code: 'RESERVATION_LIST_FORBIDDEN'
    });

    expect(auditService.appendLog).not.toHaveBeenCalled();
  });
});
