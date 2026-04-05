import { HealthService } from '../src/modules/health/health.service';

describe('HealthService privileged audit – debug access', () => {
  const buildService = () => {
    const auditService = { appendLog: jest.fn(async () => ({ id: 'audit-1' })) };
    const service = new HealthService(auditService as any);
    return { service, auditService };
  };

  it('emits privileged audit record on debug health access', async () => {
    const { service, auditService } = buildService();

    await service.auditDebugAccess('admin-1');

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'debug.health.error_sample',
        actorId: 'admin-1',
        entityType: 'debug_health',
        entityId: null,
        payload: expect.objectContaining({
          access_basis: 'permission_based',
          outcome: 'success',
          filters: {}
        })
      })
    );
  });

  it('calls appendLog exactly once per debug access', async () => {
    const { service, auditService } = buildService();

    await service.auditDebugAccess('admin-2');

    expect(auditService.appendLog).toHaveBeenCalledTimes(1);
  });

  it('getHealth does not trigger audit logging', () => {
    const { service, auditService } = buildService();

    const result = service.getHealth();

    expect(result).toHaveProperty('status', 'ok');
    expect(result).toHaveProperty('timestamp');
    expect(auditService.appendLog).not.toHaveBeenCalled();
  });
});
