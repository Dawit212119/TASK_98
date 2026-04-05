import { AnalyticsEventService } from '../src/modules/analytics/analytics-event.service';

describe('AnalyticsEventService audit logging', () => {
  const buildService = () => {
    const accessControlService = {
      getUserPermissions: jest.fn(),
      getUserRoleNames: jest.fn()
    };
    const auditService = {
      appendLog: jest.fn(async () => ({ id: 'audit-1' }))
    };
    const eventRepository = {
      create: jest.fn((payload: unknown) => payload),
      save: jest.fn(),
      createQueryBuilder: jest.fn()
    };

    const service = new AnalyticsEventService(
      accessControlService as any,
      auditService as any,
      eventRepository as any
    );

    return { service, accessControlService, auditService, eventRepository };
  };

  const buildGroupByQueryBuilder = (rows: Array<{ event_type: string; count: string }>) => {
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      groupBy: jest.fn(() => qb),
      getRawMany: jest.fn(async () => rows)
    };
    return qb;
  };

  const buildSingleRowQueryBuilder = (row: Record<string, string>) => {
    const qb: any = {
      select: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      getRawOne: jest.fn(async () => row)
    };
    return qb;
  };

  it('writes audit log on event ingest', async () => {
    const { service, accessControlService, auditService, eventRepository } = buildService();

    accessControlService.getUserPermissions.mockResolvedValue(['analytics.api.use']);
    eventRepository.save.mockResolvedValue({
      id: 'event-1',
      eventType: 'impression',
      subjectType: 'article',
      subjectId: '11111111-1111-4111-8111-111111111111',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      version: 1
    });

    await service.ingestEvent('22222222-2222-4222-8222-222222222222', {
      event_type: 'impression',
      subject_type: 'article',
      subject_id: '11111111-1111-4111-8111-111111111111',
      occurred_at: '2026-01-01T00:00:00.000Z',
      metadata: { source: 'web' }
    } as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'analytics.event.ingest',
        actorId: '22222222-2222-4222-8222-222222222222',
        entityType: 'analytics_event',
        entityId: 'event-1',
        payload: expect.objectContaining({
          access_basis: 'permission_based',
          outcome: 'success',
          filters: {},
          event_type: 'impression'
        })
      })
    );
  });

  it('writes audit log on funnel aggregation read', async () => {
    const { service, accessControlService, auditService, eventRepository } = buildService();

    accessControlService.getUserPermissions.mockResolvedValue(['analytics.api.use']);
    eventRepository.createQueryBuilder.mockReturnValue(
      buildGroupByQueryBuilder([
        { event_type: 'impression', count: '10' },
        { event_type: 'conversion', count: '2' }
      ])
    );

    await service.getFunnelAggregation('33333333-3333-4333-8333-333333333333', {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-07T23:59:59.999Z',
      subject_type: 'article'
    });

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'analytics.funnel.read',
        actorId: '33333333-3333-4333-8333-333333333333',
        entityType: 'analytics_aggregation'
      })
    );
  });

  it('writes audit log on retention aggregation read', async () => {
    const { service, accessControlService, auditService, eventRepository } = buildService();

    accessControlService.getUserPermissions.mockResolvedValue(['analytics.api.use']);
    eventRepository.createQueryBuilder
      .mockReturnValueOnce(buildSingleRowQueryBuilder({ cohort_size: '12' }))
      .mockReturnValueOnce(buildSingleRowQueryBuilder({ active_size: '6' }));

    await service.getRetentionAggregation('44444444-4444-4444-8444-444444444444', {
      cohort_start: '2026-01-01T00:00:00.000Z',
      cohort_end: '2026-01-31T23:59:59.999Z',
      bucket: 'overall'
    });

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'analytics.retention.read',
        actorId: '44444444-4444-4444-8444-444444444444',
        entityType: 'analytics_aggregation',
        payload: expect.objectContaining({
          access_basis: 'permission_based',
          outcome: 'success',
          filters: expect.objectContaining({
            cohort_start: expect.any(String),
            cohort_end: expect.any(String)
          })
        })
      })
    );
  });

  it('skips audit logging for internal system aggregation calls', async () => {
    const { service, auditService, eventRepository } = buildService();

    eventRepository.createQueryBuilder.mockReturnValue(
      buildGroupByQueryBuilder([{ event_type: 'impression', count: '4' }])
    );

    await service.getContentQualityAggregation('system', {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-02T00:00:00.000Z'
    });

    expect(auditService.appendLog).not.toHaveBeenCalled();
  });
});
