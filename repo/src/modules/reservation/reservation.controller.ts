import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { AppendReservationNoteDto } from './dto/append-reservation-note.dto';
import { CancelReservationDto } from './dto/cancel-reservation.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationListQueryDto } from './dto/reservation-list-query.dto';
import { RescheduleReservationDto } from './dto/reschedule-reservation.dto';
import { ReservationService } from './reservation.service';

@Controller('reservations')
@UseGuards(JwtAuthGuard)
@ApiTags('Reservations')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient role or out-of-scope reservation access' })
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createReservation(@CurrentUser() user: AuthenticatedUser, @Body() payload: CreateReservationDto): Promise<Record<string, unknown>> {
    return this.reservationService.createReservation(user.userId, payload);
  }

  @Get()
  listReservations(@CurrentUser() user: AuthenticatedUser, @Query() query: ReservationListQueryDto): Promise<Record<string, unknown>> {
    return this.reservationService.listReservations(user.userId, query);
  }

  @Get(':reservation_id')
  getReservation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string
  ): Promise<Record<string, unknown>> {
    return this.reservationService.getReservationById(user.userId, reservationId);
  }

  @Post(':reservation_id/notes')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  appendReservationNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string,
    @Body() payload: AppendReservationNoteDto
  ): Promise<Record<string, unknown>> {
    return this.reservationService.appendReservationNote(user.userId, reservationId, payload);
  }

  @Post(':reservation_id/confirm')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  confirmReservation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string
  ): Promise<Record<string, unknown>> {
    return this.reservationService.confirmReservation(user.userId, reservationId);
  }

  @Post(':reservation_id/reschedule')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  rescheduleReservation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string,
    @Body() payload: RescheduleReservationDto
  ): Promise<Record<string, unknown>> {
    return this.reservationService.rescheduleReservation(user.userId, reservationId, payload);
  }

  @Post(':reservation_id/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancelReservation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string,
    @Body() payload: CancelReservationDto
  ): Promise<Record<string, unknown>> {
    return this.reservationService.cancelReservation(user.userId, reservationId, payload);
  }

  @Post(':reservation_id/complete')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  completeReservation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservation_id') reservationId: string
  ): Promise<Record<string, unknown>> {
    return this.reservationService.completeReservation(user.userId, reservationId);
  }
}
