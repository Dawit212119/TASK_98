/**
 * Unit tests for getCreditTier object-level / tenant-level authorization.
 *
 * Covers:
 *  - self access: always allowed
 *  - ops_admin access: always allowed (no scope check)
 *  - staff with scoped relationship (shared reservation in scope): allowed
 *  - staff with no assigned scopes: forbidden
 *  - staff with scopes but no matching reservation for target user: forbidden
 */
import { AppException } from '../src/common/exceptions/app.exception';
import { TrustRatingService } from '../src/modules/trust-rating/trust-rating.service';

const STAFF_ID = 'staff-aaaa-0000-4000-8000-aaaaaaaaaaaa';
const OPS_ID = 'ops-bbbb-0000-4000-8000-bbbbbbbbbbbb';
const PATIENT_ID = 'patient-cccc-0000-4000-8000-cccccccccccc';
const SCOPE_ID = 'scope-dddd-0000-4000-8000-dddddddddddd';

const TIER_RECORD = {
  userId: PATIENT_ID,
  tier: 'GOLD',
  factorsSnapshot: { average_score: 4.5 },
  effectiveAt: new Date('2026-01-01T00:00:00.000Z')
};

function buildService({
  roles,
  scopeIds,
  reservationCount
}: {
  roles: string[];
  scopeIds: string[];
  reservationCount: number;
}) {
  const accessControlService = {
    getUserRoleNames: jest.fn().mockResolvedValue(roles)
  };

  const scopePolicyService = {
    getUserScopeIds: jest.fn().mockResolvedValue(scopeIds)
  };

  const auditService = { appendLog: jest.fn().mockResolvedValue({}) };

  // createQueryBuilder mock that returns reservationCount from getCount()
  const reservationRepository = {
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.innerJoin = jest.fn(() => qb);
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.getCount = jest.fn().mockResolvedValue(reservationCount);
      return qb;
    })
  };

  const creditTierRepository = {
    findOne: jest.fn().mockResolvedValue(TIER_RECORD)
  };

  const service = new TrustRatingService(
    accessControlService as any,
    scopePolicyService as any,
    auditService as any,
    reservationRepository as any,
    {} as any,  // transitionRepository
    {} as any,  // reviewRepository
    {} as any,  // reviewAppealRepository
    {} as any,  // appealDecisionRepository
    creditTierRepository as any,
    {} as any,  // fraudFlagRepository
    {} as any   // activitySignalRepository
  );

  return { service, scopePolicyService, reservationRepository, auditService };
}

describe('TrustRatingService.getCreditTier — object-level scope enforcement', () => {
  it('allows self-read regardless of role', async () => {
    const { service } = buildService({ roles: ['patient'], scopeIds: [], reservationCount: 0 });
    const result = await service.getCreditTier(PATIENT_ID, PATIENT_ID);
    expect(result.tier).toBe('GOLD');
  });

  it('allows ops_admin to read any user credit tier without scope check', async () => {
    const { service, scopePolicyService, reservationRepository } = buildService({
      roles: ['ops_admin'],
      scopeIds: [],
      reservationCount: 0
    });
    const result = await service.getCreditTier(OPS_ID, PATIENT_ID);
    expect(result.tier).toBe('GOLD');
    // No scope queries should be made for ops_admin
    expect(scopePolicyService.getUserScopeIds).not.toHaveBeenCalled();
    expect(reservationRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('allows staff with a shared scoped reservation for the target user', async () => {
    const { service } = buildService({
      roles: ['staff'],
      scopeIds: [SCOPE_ID],
      reservationCount: 1   // one matching reservation in scope
    });
    const result = await service.getCreditTier(STAFF_ID, PATIENT_ID);
    expect(result.tier).toBe('GOLD');
  });

  it('forbids staff that have no assigned data scopes', async () => {
    const { service } = buildService({
      roles: ['staff'],
      scopeIds: [],          // no scopes assigned
      reservationCount: 0
    });
    await expect(service.getCreditTier(STAFF_ID, PATIENT_ID)).rejects.toMatchObject({
      code: 'FORBIDDEN'
    } as AppException);
  });

  it('forbids staff with scopes but no reservation linking them to the target user', async () => {
    const { service } = buildService({
      roles: ['staff'],
      scopeIds: [SCOPE_ID],
      reservationCount: 0   // no matching reservation
    });
    await expect(service.getCreditTier(STAFF_ID, PATIENT_ID)).rejects.toMatchObject({
      code: 'FORBIDDEN'
    } as AppException);
  });

  it('forbids a non-staff, non-admin, non-self caller', async () => {
    const { service } = buildService({
      roles: ['analytics_viewer'],
      scopeIds: [],
      reservationCount: 0
    });
    await expect(service.getCreditTier('random-user', PATIENT_ID)).rejects.toMatchObject({
      code: 'FORBIDDEN'
    } as AppException);
  });
});
