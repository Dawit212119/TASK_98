import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { ArbitrateAppealDto } from './dto/arbitrate-appeal.dto';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { FraudFlagQueryDto } from './dto/fraud-flag-query.dto';
import { TrustRatingService } from './trust-rating.service';

@Controller()
@UseGuards(JwtAuthGuard)
@ApiTags('Trust Rating')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient role or out-of-scope trust resource' })
export class TrustRatingController {
  constructor(private readonly trustRatingService: TrustRatingService) {}

  @Post('reservations/:reservation_id/reviews')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string,
    @Body() payload: CreateReviewDto
  ): Promise<Record<string, unknown>> {
    return this.trustRatingService.createReview(user.userId, reservationId, payload);
  }

  @Get('reservations/:reservation_id/reviews')
  @HttpCode(HttpStatus.OK)
  listReservationReviews(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string
  ): Promise<Record<string, unknown>> {
    return this.trustRatingService.listReservationReviews(user.userId, reservationId);
  }

  @Post('reviews/:review_id/appeals')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createAppeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('review_id') reviewId: string,
    @Body() payload: CreateAppealDto
  ): Promise<Record<string, unknown>> {
    return this.trustRatingService.createAppeal(user.userId, reviewId, payload);
  }

  @Post('appeals/:appeal_id/arbitrate')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  arbitrateAppeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appeal_id') appealId: string,
    @Body() payload: ArbitrateAppealDto
  ): Promise<Record<string, unknown>> {
    return this.trustRatingService.arbitrateAppeal(user.userId, appealId, payload);
  }

  @Get('trust/credit-tiers/:user_id')
  @HttpCode(HttpStatus.OK)
  getCreditTier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('user_id') targetUserId: string
  ): Promise<Record<string, unknown>> {
    return this.trustRatingService.getCreditTier(user.userId, targetUserId);
  }

  @Get('trust/fraud-flags')
  @HttpCode(HttpStatus.OK)
  listFraudFlags(@CurrentUser() user: AuthenticatedUser, @Query() query: FraudFlagQueryDto): Promise<Record<string, unknown>> {
    return this.trustRatingService.listFraudFlags(user.userId, query);
  }
}
