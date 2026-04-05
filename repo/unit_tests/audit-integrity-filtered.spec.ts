import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLogEntity } from '../src/modules/audit/audit-log.entity';
import { createHash } from 'node:crypto';

describe('AuditService verifyIntegrity with filtered time windows', () => {
  const hash = (input: string) => createHash('sha256').update(input).digest('hex');

  const baseTime = new Date('2026-01-01T00:00:00.000Z');
  const hash0 = hash('input-0');
  const hash1 = hash('input-1');
  const hash2 = hash('input-2');

  // Row 0: outside the window (predecessor)
  // Row 1: first in window, previous_hash = hash0
  // Row 2: second in window, previous_hash = hash1
  const allRows: AuditLogEntity[] = [
    {
      id: 'a0', entityType: 'x', entityId: null, action: 'x.init', actorId: null,
      previousHash: null, entryHash: hash0, hashInput: 'input-0', payload: {},
      createdAt: baseTime, updatedAt: baseTime, version: 1, deletedAt: null
    } as AuditLogEntity,
    {
      id: 'a1', entityType: 'x', entityId: null, action: 'x.create', actorId: null,
      previousHash: hash0, entryHash: hash1, hashInput: 'input-1', payload: {},
      createdAt: new Date(baseTime.getTime() + 60000), updatedAt: new Date(baseTime.getTime() + 60000),
      version: 1, deletedAt: null
    } as AuditLogEntity,
    {
      id: 'a2', entityType: 'x', entityId: null, action: 'x.update', actorId: null,
      previousHash: hash1, entryHash: hash2, hashInput: 'input-2', payload: {},
      createdAt: new Date(baseTime.getTime() + 120000), updatedAt: new Date(baseTime.getTime() + 120000),
      version: 1, deletedAt: null
    } as AuditLogEntity
  ];

  const buildService = (windowRows: AuditLogEntity[], predecessorRow: AuditLogEntity | null) => {
    const mainQb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => windowRows)
    };

    const predecessorQb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => predecessorRow)
    };

    let qbCallCount = 0;
    const repo = {
      createQueryBuilder: jest.fn(() => {
        qbCallCount++;
        // First call is for the main query, second is for predecessor lookup
        return qbCallCount === 1 ? mainQb : predecessorQb;
      })
    };

    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(), query: jest.fn(), startTransaction: jest.fn(),
        manager: { createQueryBuilder: jest.fn(), save: jest.fn() },
        commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn()
      })
    };

    return new AuditService(repo as any, mockDataSource as any);
  };

  it('valid chain with filtered window — predecessor outside window is resolved', async () => {
    const windowRows = [allRows[1]!, allRows[2]!];
    const service = buildService(windowRows, allRows[0]!);

    const result = await service.verifyIntegrity({
      from: new Date(baseTime.getTime() + 60000).toISOString(),
      to: new Date(baseTime.getTime() + 120000).toISOString()
    });

    expect(result.valid).toBe(true);
    expect(result.checked_count).toBe(2);
  });

  it('detects actual tampering within filtered window', async () => {
    const tamperedRow2 = { ...allRows[2]!, entryHash: 'tampered-hash-value' };
    const windowRows = [allRows[1]!, tamperedRow2];
    const service = buildService(windowRows, allRows[0]!);

    const result = await service.verifyIntegrity({
      from: new Date(baseTime.getTime() + 60000).toISOString(),
      to: new Date(baseTime.getTime() + 120000).toISOString()
    });

    expect(result.valid).toBe(false);
    expect(result.first_invalid_record_id).toBe('a2');
  });

  it('detects broken chain link within filtered window', async () => {
    const brokenRow2 = { ...allRows[2]!, previousHash: 'wrong-previous-hash' };
    const windowRows = [allRows[1]!, brokenRow2];
    const service = buildService(windowRows, allRows[0]!);

    const result = await service.verifyIntegrity({
      from: new Date(baseTime.getTime() + 60000).toISOString(),
      to: new Date(baseTime.getTime() + 120000).toISOString()
    });

    expect(result.valid).toBe(false);
    expect(result.first_invalid_record_id).toBe('a2');
  });

  it('full-range verification (no filters) still works unchanged', async () => {
    // When no filters, predecessor lookup is skipped; first row must have null previous_hash
    const service = buildService(allRows, null);

    const result = await service.verifyIntegrity({ limit: 100 });

    expect(result.valid).toBe(true);
    expect(result.checked_count).toBe(3);
  });

  it('handles predecessor not found gracefully (first row IS first record)', async () => {
    // First row has previous_hash but predecessor lookup returns null —
    // this means chain is broken (previous_hash points to nonexistent record)
    const windowRows = [allRows[1]!];
    const service = buildService(windowRows, null);

    const result = await service.verifyIntegrity({
      from: new Date(baseTime.getTime() + 60000).toISOString()
    });

    // previous_hash is hash0, but predecessor not found means previousEntryHash stays null
    // so row[0].previousHash (hash0) !== null → invalid
    expect(result.valid).toBe(false);
    expect(result.first_invalid_record_id).toBe('a1');
  });

  it('handles window where first row has null previous_hash', async () => {
    // The first record ever, queried with a from filter
    const windowRows = [allRows[0]!];
    const service = buildService(windowRows, null);

    const result = await service.verifyIntegrity({
      from: baseTime.toISOString()
    });

    expect(result.valid).toBe(true);
    expect(result.checked_count).toBe(1);
  });
});
