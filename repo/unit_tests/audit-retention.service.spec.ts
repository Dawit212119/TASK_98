import { ConfigService } from '@nestjs/config';
import { AuditRetentionService } from '../src/modules/audit/audit-retention.service';
import { AuditLogEntity } from '../src/modules/audit/audit-log.entity';

type QueryBuilderMock = {
  where: jest.MockedFunction<(sql: string, params?: Record<string, unknown>) => QueryBuilderMock>;
  andWhere: jest.MockedFunction<(sql: string, params?: Record<string, unknown>) => QueryBuilderMock>;
  orderBy: jest.MockedFunction<(field: string, order: 'ASC' | 'DESC') => QueryBuilderMock>;
  addOrderBy: jest.MockedFunction<(field: string, order: 'ASC' | 'DESC') => QueryBuilderMock>;
  take: jest.MockedFunction<(limit: number) => QueryBuilderMock>;
  getMany: jest.MockedFunction<() => Promise<AuditLogEntity[]>>;
};

describe('AuditRetentionService', () => {
  const createService = (candidates: AuditLogEntity[]) => {
    const queryBuilder: QueryBuilderMock = {
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn(async () => candidates)
    };

    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.addOrderBy.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);

    const auditRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder)
    };

    const retentionRunRepository = {
      create: jest.fn((payload: Record<string, unknown>) => payload),
      save: jest.fn(async (payload: Record<string, unknown>) => ({ ...payload, id: 'run-1' }))
    };

    const auditService = {
      appendLog: jest.fn(async () => ({ id: 'audit-log' }))
    };

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'AUDIT_RETENTION_YEARS') {
          return 7;
        }
        return undefined;
      })
    } as unknown as ConfigService;

    const service = new AuditRetentionService(
      configService,
      auditService as any,
      auditRepository as any,
      retentionRunRepository as any
    );

    return { service, auditRepository, retentionRunRepository, auditService };
  };

  it('marks records older than 7 years as retention-eligible', () => {
    const { service } = createService([]);
    const reference = new Date('2026-01-01T00:00:00.000Z');

    expect(service.isOlderThanRetention(new Date('2018-12-31T23:59:59.000Z'), reference)).toBe(true);
    expect(service.isOlderThanRetention(new Date('2019-01-01T00:00:00.000Z'), reference)).toBe(false);
    expect(service.isOlderThanRetention(new Date('2019-01-01T00:00:01.000Z'), reference)).toBe(false);
  });

  it('creates retention marker and never deletes records newer than threshold', async () => {
    const olderEntry = {
      id: 'audit-1',
      createdAt: new Date('2018-06-01T00:00:00.000Z')
    } as AuditLogEntity;
    const { service, retentionRunRepository, auditService } = createService([olderEntry]);

    const result = await service.runProtectedRetentionJob('11111111-1111-1111-1111-111111111111', {
      referenceDate: new Date('2026-06-01T00:00:00.000Z')
    });

    expect(result.candidate_count).toBe(1);
    expect(result.deleted_count).toBe(0);
    expect(result.strategy).toBe('PROTECTED_NO_DELETE');
    expect(retentionRunRepository.save).toHaveBeenCalledTimes(1);
    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'audit.retention.run',
        payload: expect.objectContaining({ protected_cleanup: true })
      })
    );
  });
});
