import { TrustRatingService } from '../src/modules/trust-rating/trust-rating.service';

describe('TrustRatingService appeals and privileged read audits', () => {
  const actorStaffId = 'staff-11111111-1111-4111-8111-111111111111';
  const actorOpsId = 'ops-22222222-2222-4222-8222-222222222222';
  const targetUserId = 'user-target-3333-4333-8333-333333333333';
  const reviewId = 'review-44444444-4444-4444-8444-444444444444';

  const buildAppealContext = () => {
    const accessControlService = { getUserRoleNames: jest.fn() };
    const scopePolicyService = {};
    const auditService = { appendLog: jest.fn().mockResolvedValue({ id: 'log-1' }) };
    const reservationRepository = {};
    const transitionRepository = {};
    const reviewRepository = { findOne: jest.fn() };
    const reviewAppealRepository = { create: jest.fn((x: unknown) => x), save: jest.fn() };
    const appealDecisionRepository = {};
    const creditTierRepository = {};
    const fraudFlagRepository = {};
    const activitySignalRepository = {};

    const service = new TrustRatingService(
      accessControlService as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      reviewRepository as any,
      reviewAppealRepository as any,
      appealDecisionRepository as any,
      creditTierRepository as any,
      fraudFlagRepository as any,
      activitySignalRepository as any
    );

    return {
      service,
      accessControlService,
      auditService,
      reviewRepository,
      reviewAppealRepository
    };
  };

  it('createAppeal rejects non-negative review', async () => {
    const { service, reviewRepository } = buildAppealContext();
    reviewRepository.findOne.mockResolvedValue({
      id: reviewId,
      targetUserId: actorStaffId,
      createdAt: new Date(),
      dimensions: [{ name: 'professionalism', score: 4 }]
    });

    await expect(
      service.createAppeal(actorStaffId, reviewId, { reason: 'Disagree' })
    ).rejects.toMatchObject({ code: 'APPEAL_REQUIRES_NEGATIVE_REVIEW' });
  });

  it('createAppeal allows negative review (score <= 2)', async () => {
    const { service, reviewRepository, reviewAppealRepository, auditService } = buildAppealContext();
    const createdAt = new Date();
    reviewRepository.findOne.mockResolvedValue({
      id: reviewId,
      targetUserId: actorStaffId,
      createdAt,
      dimensions: [{ name: 'professionalism', score: 2 }]
    });
    reviewAppealRepository.save.mockResolvedValue({
      id: 'appeal-1',
      reviewId,
      appellantUserId: actorStaffId,
      reason: 'Mistake',
      evidenceFiles: [],
      status: 'OPEN',
      createdAt,
      version: 1
    });

    const out = await service.createAppeal(actorStaffId, reviewId, { reason: 'Mistake' });

    expect(out.appeal_id).toBe('appeal-1');
    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'trust.appeal.create',
        entityType: 'review_appeal'
      })
    );
  });

  const buildCreditTierContext = () => {
    const accessControlService = { getUserRoleNames: jest.fn() };
    // scopePolicyService needs getUserScopeIds for the staff scope-check path.
    const scopePolicyService = {
      getUserScopeIds: jest.fn().mockResolvedValue(['scope-1'])
    };
    const auditService = { appendLog: jest.fn().mockResolvedValue({}) };
    // reservationRepository needs createQueryBuilder for the staff in-scope query.
    const reservationQb: any = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1)   // ≥1 means staff is in scope
    };
    const reservationRepository = {
      createQueryBuilder: jest.fn(() => reservationQb)
    };
    const transitionRepository = {};
    const reviewRepository = {};
    const reviewAppealRepository = {};
    const appealDecisionRepository = {};
    const creditTierRepository = { findOne: jest.fn() };
    const fraudFlagRepository = {};
    const activitySignalRepository = {};

    const service = new TrustRatingService(
      accessControlService as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      reviewRepository as any,
      reviewAppealRepository as any,
      appealDecisionRepository as any,
      creditTierRepository as any,
      fraudFlagRepository as any,
      activitySignalRepository as any
    );

    return { service, accessControlService, auditService, creditTierRepository };
  };

  it('getCreditTier appends audit for staff reader', async () => {
    const { service, accessControlService, auditService, creditTierRepository } = buildCreditTierContext();
    accessControlService.getUserRoleNames.mockResolvedValue(['staff']);
    creditTierRepository.findOne.mockResolvedValue({
      userId: targetUserId,
      tier: 'SILVER',
      factorsSnapshot: { average_score: 3.5 },
      effectiveAt: new Date('2026-01-01T00:00:00.000Z')
    });

    await service.getCreditTier(actorStaffId, targetUserId);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'trust.credit_tier.read',
        entityType: 'credit_tier',
        entityId: targetUserId,
        actorId: actorStaffId,
        payload: expect.objectContaining({
          access_basis: 'staff',
          outcome: 'success',
          filters: {},
          target_user_id: targetUserId,
          tier: 'SILVER',
          had_record: true,
          self_lookup: false
        })
      })
    );
  });

  it('getCreditTier does not append audit for patient self-read', async () => {
    const { service, accessControlService, auditService, creditTierRepository } = buildCreditTierContext();
    accessControlService.getUserRoleNames.mockResolvedValue(['patient']);
    creditTierRepository.findOne.mockResolvedValue(null);

    const out = await service.getCreditTier(targetUserId, targetUserId);

    expect(out.tier).toBe('UNRATED');
    expect(auditService.appendLog).not.toHaveBeenCalled();
  });

  const buildFraudFlagsContext = () => {
    const accessControlService = { getUserRoleNames: jest.fn() };
    const scopePolicyService = {};
    const auditService = { appendLog: jest.fn().mockResolvedValue({}) };
    const reservationRepository = {};
    const transitionRepository = {};
    const reviewRepository = {};
    const reviewAppealRepository = {};
    const appealDecisionRepository = {};
    const creditTierRepository = {};
    const fraudFlagRepository = { createQueryBuilder: jest.fn() };
    const activitySignalRepository = {};

    const service = new TrustRatingService(
      accessControlService as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      reviewRepository as any,
      reviewAppealRepository as any,
      appealDecisionRepository as any,
      creditTierRepository as any,
      fraudFlagRepository as any,
      activitySignalRepository as any
    );

    return { service, accessControlService, auditService, fraudFlagRepository };
  };

  it('listFraudFlags appends audit with filter and count summary', async () => {
    const { service, accessControlService, auditService, fraudFlagRepository } = buildFraudFlagsContext();
    accessControlService.getUserRoleNames.mockResolvedValue(['ops_admin']);

    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 'flag-1',
            userId: targetUserId,
            reason: 'x',
            severity: 'LOW',
            details: {},
            createdAt: new Date()
          }
        ],
        12
      ])
    };
    fraudFlagRepository.createQueryBuilder.mockReturnValue(qb);

    await service.listFraudFlags(actorOpsId, {
      page: 1,
      page_size: 5,
      user_id: targetUserId,
      from: undefined,
      to: undefined
    } as any);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'trust.fraud_flags.read',
        entityType: 'fraud_flag_query',
        actorId: actorOpsId,
        payload: expect.objectContaining({
          access_basis: 'ops_admin',
          outcome: 'success',
          filters: expect.objectContaining({
            user_id: targetUserId,
            from: null,
            to: null,
            result_total: 12,
            returned_count: 1,
            page: 1,
            page_size: 5
          })
        })
      })
    );
  });

  const buildCreateReviewContext = () => {
    const accessControlService = { getUserRoleNames: jest.fn() };
    const scopePolicyService = { assertReservationInScope: jest.fn() };
    const auditService = { appendLog: jest.fn().mockResolvedValue({ id: 'log-1' }) };
    const reservationRepository = { findOne: jest.fn() };
    const transitionRepository = { findOne: jest.fn() };
    const reviewRepository = { findOne: jest.fn(), create: jest.fn((x: unknown) => x), save: jest.fn() };
    const reviewAppealRepository = {};
    const appealDecisionRepository = {};
    const creditTierRepository = {};
    const fraudFlagRepository = {};
    const activitySignalRepository = {};

    const service = new TrustRatingService(
      accessControlService as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      reviewRepository as any,
      reviewAppealRepository as any,
      appealDecisionRepository as any,
      creditTierRepository as any,
      fraudFlagRepository as any,
      activitySignalRepository as any
    );

    return { service, reservationRepository, transitionRepository, reviewRepository };
  };

  it('createReview rejects duplicate directional review for same reservation', async () => {
    const { service, reservationRepository, transitionRepository, reviewRepository } = buildCreateReviewContext();
    const now = new Date();
    reservationRepository.findOne.mockResolvedValue({
      id: 'res-1',
      patientId: 'patient-1',
      providerId: 'provider-1',
      status: 'COMPLETED',
      updatedAt: now,
      deletedAt: null
    });
    transitionRepository.findOne.mockResolvedValue({ createdAt: now, action: 'COMPLETE' });
    reviewRepository.findOne.mockResolvedValue({ id: 'review-existing' });

    await expect(
      service.createReview('patient-1', 'res-1', {
        target_user_id: 'provider-1',
        dimensions: [{ name: 'professionalism', score: 5 }],
        comment: 'duplicate'
      })
    ).rejects.toMatchObject({ code: 'REVIEW_ALREADY_EXISTS' });
  });
});
