import { SupportTicketService } from '../src/modules/communication/support-ticket.service';

describe('SupportTicketService listSupportTickets privileged audit', () => {
  const defaultQuery = { page: 1, page_size: 20 };

  const createService = (roles: string[], scopeIds: string[] = []) => {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [[], 0])
    };

    const supportTicketRepository = { createQueryBuilder: jest.fn(() => qb) };
    const scopePolicyService = {
      getRoles: jest.fn(async () => roles),
      getUserScopeIds: jest.fn(async () => scopeIds)
    };
    const auditService = { appendLog: jest.fn(async () => ({ id: 'audit-1' })) };

    const service = new SupportTicketService(
      {} as any,  // reservationService
      scopePolicyService as any,
      auditService as any,
      {} as any,  // notificationService
      supportTicketRepository as any
    );

    return { service, auditService };
  };

  it('emits privileged audit record on ops_admin list', async () => {
    const { service, auditService } = createService(['ops_admin']);

    await service.listSupportTickets('admin-1', defaultQuery as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.ticket.list',
        actorId: 'admin-1',
        entityType: 'support_ticket',
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
    const { service, auditService } = createService(['staff'], ['scope-1']);

    await service.listSupportTickets('staff-1', defaultQuery as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.ticket.list',
        actorId: 'staff-1',
        payload: expect.objectContaining({ access_basis: 'staff' })
      })
    );
  });

  it('emits privileged audit record with self access basis for regular user', async () => {
    const { service, auditService } = createService(['patient']);

    await service.listSupportTickets('patient-1', defaultQuery as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ access_basis: 'self' })
      })
    );
  });

  it('includes query filters in audit payload', async () => {
    const { service, auditService } = createService(['ops_admin']);

    await service.listSupportTickets('admin-1', {
      ...defaultQuery,
      status: 'OPEN',
      reservation_id: 'res-1'
    } as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          filters: expect.objectContaining({
            status: 'OPEN',
            reservation_id: 'res-1',
            result_total: 0
          })
        })
      })
    );
  });

  it('audit is emitted even when result set is empty', async () => {
    const { service, auditService } = createService(['staff'], []);

    await service.listSupportTickets('staff-no-scope', defaultQuery as any);

    expect(auditService.appendLog).toHaveBeenCalledTimes(1);
  });
});
