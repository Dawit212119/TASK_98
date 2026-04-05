/**
 * Unit tests for SensitiveWordService.listSensitiveWords — privileged audit completeness.
 *
 * Verifies that every call to listSensitiveWords by an ops_admin emits an audit log
 * entry with the actor, filter values, and result count.
 */
import { SensitiveWordService } from '../src/modules/communication/sensitive-word.service';

const OPS_ADMIN_ID = 'ops-aaaa-0000-4000-8000-aaaaaaaaaaaa';

function buildService(words: { id: string; word: string; active: boolean; createdAt: Date; updatedAt: Date }[]) {
  const configService = { get: jest.fn().mockReturnValue('') };

  const accessControlService = {
    getUserRoleNames: jest.fn().mockResolvedValue(['ops_admin'])
  };

  const auditService = { appendLog: jest.fn().mockResolvedValue({}) };

  const qb: any = {};
  qb.andWhere = jest.fn().mockReturnThis();
  qb.orderBy = jest.fn().mockReturnThis();
  qb.addOrderBy = jest.fn().mockReturnThis();
  qb.getMany = jest.fn().mockResolvedValue(words);

  const sensitiveWordRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(qb)
  };

  const service = new SensitiveWordService(
    configService as any,
    accessControlService as any,
    auditService as any,
    sensitiveWordRepository as any
  );

  return { service, auditService, qb };
}

describe('SensitiveWordService.listSensitiveWords — audit logging', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  const sampleWords = [
    { id: 'w1', word: 'spam', active: true, createdAt: now, updatedAt: now },
    { id: 'w2', word: 'abuse', active: true, createdAt: now, updatedAt: now }
  ];

  it('appends audit log after listing sensitive words (no active filter)', async () => {
    const { service, auditService } = buildService(sampleWords);

    await service.listSensitiveWords(OPS_ADMIN_ID, {});

    expect(auditService.appendLog).toHaveBeenCalledTimes(1);
    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sensitive_word.list',
        entityType: 'sensitive_word',
        actorId: OPS_ADMIN_ID,
        payload: expect.objectContaining({
          access_basis: 'ops_admin',
          outcome: 'success',
          filters: { filter_active: null },
          result_count: sampleWords.length
        })
      })
    );
  });

  it('includes filter_active value in audit payload when active filter is supplied', async () => {
    const activeOnly = sampleWords.filter((w) => w.active);
    const { service, auditService } = buildService(activeOnly);

    await service.listSensitiveWords(OPS_ADMIN_ID, { active: 'true' });

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          access_basis: 'ops_admin',
          outcome: 'success',
          filters: { filter_active: 'true' },
          result_count: activeOnly.length
        })
      })
    );
  });

  it('records result_count = 0 when no words match', async () => {
    const { service, auditService } = buildService([]);

    await service.listSensitiveWords(OPS_ADMIN_ID, { active: 'false' });

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          access_basis: 'ops_admin',
          filters: { filter_active: 'false' },
          result_count: 0
        })
      })
    );
  });
});
