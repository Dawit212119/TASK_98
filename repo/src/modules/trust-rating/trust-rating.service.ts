import { Injectable } from '@nestjs/common';
import { CategorizedLogger } from '../../common/logging/categorized-logger';
import { LogCategory } from '../../common/logging/log-redact.util';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { AccessControlService } from '../access-control/access-control.service';
import { ScopePolicyService } from '../access-control/scope-policy.service';
import { AuditService } from '../audit/audit.service';
import { ReservationStateTransitionEntity } from '../reservation/entities/reservation-state-transition.entity';
import { ReservationEntity, ReservationStatus } from '../reservation/entities/reservation.entity';
import { ArbitrateAppealDto } from './dto/arbitrate-appeal.dto';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { FraudFlagQueryDto } from './dto/fraud-flag-query.dto';
import { ActivitySignalEntity } from './entities/activity-signal.entity';
import { AppealDecisionEntity } from './entities/appeal-decision.entity';
import { CreditTierEntity } from './entities/credit-tier.entity';
import { FraudFlagEntity } from './entities/fraud-flag.entity';
import { ReviewAppealEntity } from './entities/review-appeal.entity';
import { ReviewEntity } from './entities/review.entity';
import { isNegativeReviewDimensions } from './review-negative.util';
import { isReviewWindowExpired } from './review-window.util';

@Injectable()
export class TrustRatingService {
  private readonly logger = new CategorizedLogger(LogCategory.BUSINESS, TrustRatingService.name);

  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly scopePolicyService: ScopePolicyService,
    private readonly auditService: AuditService,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationStateTransitionEntity)
    private readonly transitionRepository: Repository<ReservationStateTransitionEntity>,
    @InjectRepository(ReviewEntity)
    private readonly reviewRepository: Repository<ReviewEntity>,
    @InjectRepository(ReviewAppealEntity)
    private readonly reviewAppealRepository: Repository<ReviewAppealEntity>,
    @InjectRepository(AppealDecisionEntity)
    private readonly appealDecisionRepository: Repository<AppealDecisionEntity>,
    @InjectRepository(CreditTierEntity)
    private readonly creditTierRepository: Repository<CreditTierEntity>,
    @InjectRepository(FraudFlagEntity)
    private readonly fraudFlagRepository: Repository<FraudFlagEntity>,
    @InjectRepository(ActivitySignalEntity)
    private readonly activitySignalRepository: Repository<ActivitySignalEntity>
  ) {}

  async createReview(userId: string, reservationId: string, payload: CreateReviewDto): Promise<Record<string, unknown>> {
    const reservation = await this.reservationRepository.findOne({ where: { id: reservationId, deletedAt: IsNull() } });
    if (!reservation) {
      throw new AppException('NOT_FOUND', 'Reservation not found', { reservation_id: reservationId }, 404);
    }

    const isParticipant = reservation.patientId === userId || reservation.providerId === userId;
    if (!isParticipant) {
      throw new AppException('FORBIDDEN', 'Reservation is out of scope', { reservation_id: reservationId }, 403);
    }

    await this.scopePolicyService.assertReservationInScope(userId, reservation);

    if (reservation.status !== ReservationStatus.COMPLETED) {
      throw new AppException('REVIEW_RESERVATION_NOT_COMPLETED', 'Reviews are allowed only after completion', {}, 422);
    }

    const completionTransition = await this.transitionRepository.findOne({
      where: { reservationId, action: 'COMPLETE' },
      order: { createdAt: 'DESC' }
    });
    const completionTime = completionTransition?.createdAt ?? reservation.updatedAt;
    if (isReviewWindowExpired(completionTime)) {
      throw new AppException('REVIEW_WINDOW_EXPIRED', 'Review window has expired', {}, 422);
    }

    if (payload.target_user_id === userId) {
      throw new AppException('REVIEW_SELF_NOT_ALLOWED', 'Self-review is not allowed', {}, 422);
    }

    const counterpartyIds = [reservation.patientId, reservation.providerId].filter((id): id is string => Boolean(id && id !== userId));
    if (!counterpartyIds.includes(payload.target_user_id)) {
      throw new AppException(
        'REVIEW_TARGET_USER_INVALID',
        'target_user_id must be the reservation counterparty',
        { reservation_id: reservationId },
        422
      );
    }

    const duplicateDirectional = await this.reviewRepository.findOne({
      where: {
        reservationId,
        reviewerUserId: userId,
        targetUserId: payload.target_user_id,
        deletedAt: IsNull()
      }
    });
    if (duplicateDirectional) {
      throw new AppException('REVIEW_ALREADY_EXISTS', 'Review already exists for this reservation and direction', {}, 409);
    }

    const review = await this.reviewRepository.save(
      this.reviewRepository.create({
        reservationId,
        reviewerUserId: userId,
        targetUserId: payload.target_user_id,
        dimensions: payload.dimensions,
        comment: payload.comment ?? null
      })
    );

    await this.auditService.appendLog({
      entityType: 'review',
      entityId: review.id,
      action: 'trust.review.create',
      actorId: userId,
      payload: {
        reservation_id: reservationId,
        target_user_id: payload.target_user_id
      }
    });

    return this.mapReview(review);
  }

  async listReservationReviews(userId: string, reservationId: string): Promise<Record<string, unknown>> {
    const reservation = await this.reservationRepository.findOne({ where: { id: reservationId, deletedAt: IsNull() } });
    if (!reservation) {
      throw new AppException('NOT_FOUND', 'Reservation not found', { reservation_id: reservationId }, 404);
    }

    await this.scopePolicyService.assertReservationInScope(userId, reservation);

    const items = await this.reviewRepository.find({
      where: { reservationId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' }
    });

    return { items: items.map((item) => this.mapReview(item)) };
  }

  async createAppeal(userId: string, reviewId: string, payload: CreateAppealDto): Promise<Record<string, unknown>> {
    const review = await this.reviewRepository.findOne({ where: { id: reviewId, deletedAt: IsNull() } });
    if (!review) {
      throw new AppException('NOT_FOUND', 'Review not found', { review_id: reviewId }, 404);
    }

    if (review.targetUserId !== userId) {
      throw new AppException('FORBIDDEN', 'Only reviewed party can open appeal', {}, 403);
    }

    if (Date.now() - review.createdAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
      throw new AppException('APPEAL_WINDOW_EXPIRED', 'Appeal window has expired', {}, 422);
    }

    if (!isNegativeReviewDimensions(review.dimensions)) {
      throw new AppException(
        'APPEAL_REQUIRES_NEGATIVE_REVIEW',
        'Appeals are only allowed when the review includes at least one dimension score of 2 or below',
        { review_id: reviewId },
        422
      );
    }

    const appeal = await this.reviewAppealRepository.save(
      this.reviewAppealRepository.create({
        reviewId,
        appellantUserId: userId,
        reason: payload.reason,
        evidenceFiles: payload.evidence_files ?? [],
        status: 'OPEN'
      })
    );

    await this.auditService.appendLog({
      entityType: 'review_appeal',
      entityId: appeal.id,
      action: 'trust.appeal.create',
      actorId: userId,
      payload: { review_id: reviewId }
    });

    return {
      appeal_id: appeal.id,
      review_id: appeal.reviewId,
      status: appeal.status,
      reason: appeal.reason,
      evidence_files: appeal.evidenceFiles,
      created_at: appeal.createdAt.toISOString(),
      version: appeal.version
    };
  }

  async arbitrateAppeal(userId: string, appealId: string, payload: ArbitrateAppealDto): Promise<Record<string, unknown>> {
    const roles = await this.accessControlService.getUserRoleNames(userId);
    if (!roles.includes('ops_admin')) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    const appeal = await this.reviewAppealRepository.findOne({ where: { id: appealId, deletedAt: IsNull() } });
    if (!appeal) {
      throw new AppException('NOT_FOUND', 'Appeal not found', { appeal_id: appealId }, 404);
    }

    const decision = await this.appealDecisionRepository.save(
      this.appealDecisionRepository.create({
        appealId,
        decidedBy: userId,
        outcome: payload.outcome,
        notes: payload.notes
      })
    );

    appeal.status = payload.outcome;
    appeal.version += 1;
    await this.reviewAppealRepository.save(appeal);

    await this.auditService.appendLog({
      entityType: 'appeal_decision',
      entityId: decision.id,
      action: 'trust.appeal.arbitrate',
      actorId: userId,
      payload: {
        appeal_id: appealId,
        outcome: payload.outcome
      }
    });

    return {
      appeal_id: appeal.id,
      outcome: decision.outcome,
      notes: decision.notes,
      status: appeal.status,
      updated_at: appeal.updatedAt.toISOString()
    };
  }

  async getCreditTier(userId: string, targetUserId: string): Promise<Record<string, unknown>> {
    const roles = await this.accessControlService.getUserRoleNames(userId);
    const isSelf = targetUserId === userId;
    const isOpsAdmin = roles.includes('ops_admin');
    const isStaff = roles.includes('staff');

    if (!isSelf && !isOpsAdmin && !isStaff) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    // Staff must have a clinic-scope relationship with the target user (shared reservation in scope).
    if (isStaff && !isOpsAdmin && !isSelf) {
      const scopeIds = await this.scopePolicyService.getUserScopeIds(userId);
      if (scopeIds.length === 0) {
        throw new AppException('FORBIDDEN', 'Staff has no assigned data scopes', {}, 403);
      }

      // Count reservations where the target is the patient AND the reservation is in the staff's scope.
      const inScopeCount = await this.reservationRepository
        .createQueryBuilder('r')
        .innerJoin(
          'reservation_data_scopes',
          'rds',
          'rds.reservation_id = r.id AND rds.deleted_at IS NULL'
        )
        .where('r.patient_id = :targetUserId', { targetUserId })
        .andWhere('r.deleted_at IS NULL')
        .andWhere('rds.scope_id IN (:...scopeIds)', { scopeIds })
        .getCount();

      if (inScopeCount === 0) {
        throw new AppException('FORBIDDEN', 'Target user is not in staff clinic scope', {}, 403);
      }
    }

    const latest = await this.creditTierRepository.findOne({
      where: { userId: targetUserId },
      order: { effectiveAt: 'DESC' }
    });

    const isPrivilegedReader = roles.includes('staff') || roles.includes('ops_admin');
    if (isPrivilegedReader) {
      const tierLabel = latest?.tier ?? 'UNRATED';
      await this.auditService.appendLog({
        entityType: 'credit_tier',
        entityId: targetUserId,
        action: 'trust.credit_tier.read',
        actorId: userId,
        payload: {
          target_user_id: targetUserId,
          tier: tierLabel,
          had_record: Boolean(latest),
          self_lookup: targetUserId === userId
        }
      });
    }

    if (!latest) {
      return {
        user_id: targetUserId,
        tier: 'UNRATED',
        factors_snapshot: {},
        effective_at: null
      };
    }

    return {
      user_id: latest.userId,
      tier: latest.tier,
      factors_snapshot: latest.factorsSnapshot,
      effective_at: latest.effectiveAt.toISOString()
    };
  }

  async listFraudFlags(userId: string, query: FraudFlagQueryDto): Promise<Record<string, unknown>> {
    const roles = await this.accessControlService.getUserRoleNames(userId);
    if (!roles.includes('ops_admin')) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    const qb = this.fraudFlagRepository.createQueryBuilder('f').where('f.deleted_at IS NULL');
    if (query.user_id) {
      qb.andWhere('f.user_id = :userId', { userId: query.user_id });
    }
    if (query.from) {
      qb.andWhere('f.created_at >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('f.created_at <= :to', { to: query.to });
    }

    qb.orderBy('f.created_at', 'DESC').addOrderBy('f.id', 'DESC').skip((query.page - 1) * query.page_size).take(query.page_size);
    const [items, total] = await qb.getManyAndCount();

    await this.auditService.appendLog({
      entityType: 'fraud_flag_query',
      entityId: null,
      action: 'trust.fraud_flags.read',
      actorId: userId,
      payload: {
        filters: {
          user_id: query.user_id ?? null,
          from: query.from ?? null,
          to: query.to ?? null
        },
        page: query.page,
        page_size: query.page_size,
        result_total: total,
        returned_count: items.length
      }
    });

    return {
      items: items.map((item) => ({
        flag_id: item.id,
        user_id: item.userId,
        reason: item.reason,
        severity: item.severity,
        details: item.details,
        created_at: item.createdAt.toISOString()
      })),
      page: query.page,
      page_size: query.page_size,
      total
    };
  }

  async recordActivitySignal(input: {
    userId: string;
    actionType: string;
    ipAddress?: string | null;
    deviceId?: string | null;
  }): Promise<void> {
    await this.activitySignalRepository.save(
      this.activitySignalRepository.create({
        userId: input.userId,
        actionType: input.actionType,
        ipAddress: input.ipAddress ?? null,
        deviceId: input.deviceId ?? null
      })
    );

    const from = new Date(Date.now() - 5 * 60 * 1000);

    if (input.ipAddress) {
      const ipCount = await this.activitySignalRepository
        .createQueryBuilder('a')
        .where('a.ip_address = :ipAddress', { ipAddress: input.ipAddress })
        .andWhere('a.created_at >= :from', { from: from.toISOString() })
        .getCount();

      if (ipCount >= 10) {
        await this.insertFraudFlag({
          userId: input.userId,
          reason: 'same_ip_burst',
          severity: 'MEDIUM',
          details: {
            ip_address: input.ipAddress,
            count_last_5m: ipCount
          }
        });
      }
    }

    if (input.deviceId) {
      const deviceCount = await this.activitySignalRepository
        .createQueryBuilder('a')
        .where('a.device_id = :deviceId', { deviceId: input.deviceId })
        .andWhere('a.created_at >= :from', { from: from.toISOString() })
        .getCount();

      if (deviceCount >= 10) {
        await this.insertFraudFlag({
          userId: input.userId,
          reason: 'same_device_burst',
          severity: 'MEDIUM',
          details: {
            device_id: input.deviceId,
            count_last_5m: deviceCount
          }
        });
      }
    }
  }

  async runNightlyCreditTierComputation(): Promise<void> {
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await this.reviewRepository
      .createQueryBuilder('r')
      .select('r.target_user_id', 'user_id')
      .addSelect('AVG((dim ->> \"score\")::int)', 'avg_score')
      .addSelect('COUNT(r.id)', 'reviews_count')
      .leftJoin('jsonb_array_elements(r.dimensions)', 'dim', 'true')
      .where('r.created_at >= :from', { from: from.toISOString() })
      .groupBy('r.target_user_id')
      .getRawMany<{ user_id: string; avg_score: string; reviews_count: string }>();

    for (const row of rows) {
      const avg = Number(row.avg_score || 0);
      const tier = avg >= 4 ? 'GOLD' : avg >= 3 ? 'SILVER' : 'BRONZE';
      await this.creditTierRepository.save(
        this.creditTierRepository.create({
          userId: row.user_id,
          tier,
          factorsSnapshot: {
            average_score: avg,
            reviews_count: Number(row.reviews_count),
            rolling_days: 90
          },
          effectiveAt: new Date()
        })
      );
    }
  }

  private async insertFraudFlag(input: {
    userId: string;
    reason: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.fraudFlagRepository.save(
      this.fraudFlagRepository.create({
        userId: input.userId,
        reason: input.reason,
        severity: input.severity,
        details: input.details
      })
    );
  }

  private mapReview(review: ReviewEntity): Record<string, unknown> {
    return {
      review_id: review.id,
      reservation_id: review.reservationId,
      reviewer_user_id: review.reviewerUserId,
      target_user_id: review.targetUserId,
      dimensions: review.dimensions,
      comment: review.comment,
      created_at: review.createdAt.toISOString(),
      updated_at: review.updatedAt.toISOString(),
      version: review.version
    };
  }
}
