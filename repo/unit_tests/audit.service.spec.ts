/**
 * Acceptance: audit hash chaining on append (pairs with audit-chain.util integrity tests).
 */
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLogEntity } from '../src/modules/audit/audit-log.entity';
import { createHash } from 'node:crypto';

type QueryBuilderMock = {
  orderBy: jest.MockedFunction<(field: string, order: 'ASC' | 'DESC') => QueryBuilderMock>;
  addOrderBy: jest.MockedFunction<(field: string, order: 'ASC' | 'DESC') => QueryBuilderMock>;
  limit: jest.MockedFunction<(count: number) => QueryBuilderMock>;
  where: jest.MockedFunction<(clause: string, params?: Record<string, unknown>) => QueryBuilderMock>;
  andWhere: jest.MockedFunction<(clause: string, params?: Record<string, unknown>) => QueryBuilderMock>;
  take: jest.MockedFunction<(count: number) => QueryBuilderMock>;
  useTransaction: jest.MockedFunction<(enable: boolean) => QueryBuilderMock>;
  getOne: jest.MockedFunction<() => Promise<AuditLogEntity | null>>;
  getMany: jest.MockedFunction<() => Promise<AuditLogEntity[]>>;
};

describe('AuditService', () => {
  it('chains hashes so next log references previous entry hash', async () => {
    const saved: AuditLogEntity[] = [];

    const queryBuilder: QueryBuilderMock = {
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      limit: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      take: jest.fn(),
      useTransaction: jest.fn(),
      getOne: jest.fn(async () => (saved.length ? saved[saved.length - 1] : null)),
      getMany: jest.fn(async () => saved)
    };

    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.addOrderBy.mockReturnValue(queryBuilder);
    queryBuilder.limit.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    queryBuilder.useTransaction.mockReturnValue(queryBuilder);

    const repo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      create: jest.fn((entity: Partial<AuditLogEntity>) => ({ ...entity })),
      save: jest.fn(async (entity: Partial<AuditLogEntity>) => {
        const savedEntity = {
          id: `audit-${saved.length + 1}`,
          entityType: entity.entityType ?? '',
          entityId: entity.entityId ?? null,
          action: entity.action ?? '',
          actorId: entity.actorId ?? null,
          previousHash: entity.previousHash ?? null,
          entryHash: entity.entryHash ?? '',
          hashInput: entity.hashInput ?? null,
          payload: entity.payload ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1,
          deletedAt: null
        } as AuditLogEntity;
        saved.push(savedEntity);
        return savedEntity;
      })
    };

    const queryBuilderForDataSource: QueryBuilderMock = {
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      limit: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      take: jest.fn(),
      useTransaction: jest.fn(),
      getOne: jest.fn(async () => (saved.length ? saved[saved.length - 1] : null)),
      getMany: jest.fn(async () => [])
    };
    queryBuilderForDataSource.orderBy.mockReturnValue(queryBuilderForDataSource);
    queryBuilderForDataSource.addOrderBy.mockReturnValue(queryBuilderForDataSource);
    queryBuilderForDataSource.limit.mockReturnValue(queryBuilderForDataSource);
    queryBuilderForDataSource.useTransaction.mockReturnValue(queryBuilderForDataSource);

    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        query: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          createQueryBuilder: jest.fn(() => queryBuilderForDataSource),
          save: jest.fn(async (entity: Partial<AuditLogEntity>) => {
            const savedEntity = {
              id: `audit-${saved.length + 1}`,
              entityType: entity.entityType ?? '',
              entityId: entity.entityId ?? null,
              action: entity.action ?? '',
              actorId: entity.actorId ?? null,
              previousHash: entity.previousHash ?? null,
              entryHash: entity.entryHash ?? '',
              hashInput: entity.hashInput ?? null,
              payload: entity.payload ?? {},
              createdAt: new Date(),
              updatedAt: new Date(),
              version: 1,
              deletedAt: null
            } as AuditLogEntity;
            saved.push(savedEntity);
            return savedEntity;
          })
        },
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn()
      })
    };

    const service = new AuditService(repo as any, mockDataSource as any);

    const first = await service.appendLog({
      entityType: 'reservation',
      entityId: '11111111-1111-1111-1111-111111111111',
      action: 'reservation.create',
      actorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      payload: { step: 1 }
    });

    const second = await service.appendLog({
      entityType: 'reservation',
      entityId: '11111111-1111-1111-1111-111111111111',
      action: 'reservation.confirm',
      actorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      payload: { step: 2 }
    });

    expect(first.previousHash).toBeNull();
    expect(first.entryHash).toHaveLength(64);
    expect(second.previousHash).toBe(first.entryHash);
    expect(second.entryHash).toHaveLength(64);
    expect(second.entryHash).not.toBe(first.entryHash);
    expect(first.hashInput).toBeTruthy();
    expect(second.hashInput).toBeTruthy();
    // appendLog now uses queryRunner.manager.createQueryBuilder (transaction-scoped) instead of repo.createQueryBuilder
    const queryRunner = (mockDataSource.createQueryRunner as jest.Mock).mock.results[0]?.value;
    expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'));
    expect(queryRunner.manager.createQueryBuilder).toHaveBeenCalledTimes(2);
  });

  it('verifies integrity and detects tampered entry hash', async () => {
    const baseTime = new Date('2026-01-01T00:00:00.000Z');
    const hash1 = createHash('sha256').update('input-1').digest('hex');
    const hash2 = createHash('sha256').update('input-2').digest('hex');
    const validRows: AuditLogEntity[] = [
      {
        id: 'a1',
        entityType: 'x',
        entityId: null,
        action: 'x.create',
        actorId: null,
        previousHash: null,
        entryHash: hash1,
        hashInput: 'input-1',
        payload: {},
        createdAt: baseTime,
        updatedAt: baseTime,
        version: 1,
        deletedAt: null
      } as AuditLogEntity,
      {
        id: 'a2',
        entityType: 'x',
        entityId: null,
        action: 'x.update',
        actorId: null,
        previousHash: hash1,
        entryHash: hash2,
        hashInput: 'input-2',
        payload: {},
        createdAt: new Date(baseTime.getTime() + 1000),
        updatedAt: new Date(baseTime.getTime() + 1000),
        version: 1,
        deletedAt: null
      } as AuditLogEntity
    ];

    const queryBuilder: QueryBuilderMock = {
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      limit: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      take: jest.fn(),
      useTransaction: jest.fn(),
      getOne: jest.fn(async () => null),
      getMany: jest.fn(async () => validRows)
    };
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.addOrderBy.mockReturnValue(queryBuilder);
    queryBuilder.limit.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    queryBuilder.useTransaction.mockReturnValue(queryBuilder);

    const repo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      create: jest.fn((entity: Partial<AuditLogEntity>) => ({ ...entity })),
      save: jest.fn(async (entity: Partial<AuditLogEntity>) => entity)
    };

    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        query: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          createQueryBuilder: jest.fn(),
          save: jest.fn(async (e) => e)
        },
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn()
      })
    };

    const service = new AuditService(repo as any, mockDataSource as any);

    const validResult = await service.verifyIntegrity({ limit: 100 });
    expect(validResult.valid).toBe(true);
    expect(validResult.checked_count).toBe(2);

    validRows[1]!.entryHash = 'tampered-hash';

    const invalidResult = await service.verifyIntegrity({ limit: 100 });
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.first_invalid_record_id).toBe('a2');
  });
});
