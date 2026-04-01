/**
 * Unit tests for ReservationService invalid state-machine transitions.
 * Each test asserts RESERVATION_INVALID_STATE is thrown for an illegal move.
 */
import { ReservationService } from '../src/modules/reservation/reservation.service';
import { ReservationEntity, ReservationStatus } from '../src/modules/reservation/entities/reservation.entity';

describe('ReservationService invalid state transitions', () => {
  const reservationId = 'res-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userId = 'user-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const makeReservation = (status: ReservationStatus): ReservationEntity =>
    ({
      id: reservationId,
      patientId: userId,
      providerId: userId,
      status,
      startTime: new Date(Date.now() + 48 * 60 * 60 * 1000),
      endTime: new Date(Date.now() + 49 * 60 * 60 * 1000),
      refundPercentage: null,
      refundStatus: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null
    } as ReservationEntity);

  const build = (reservationStatus: ReservationStatus) => {
    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['ops_admin']),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined)
    };
    const auditService = { appendLog: jest.fn() };
    const reservationRepository = {
      findOne: jest.fn().mockResolvedValue(makeReservation(reservationStatus)),
      create: jest.fn((x: unknown) => x),
      save: jest.fn()
    };
    const transitionRepository = { create: jest.fn((x: unknown) => x), save: jest.fn() };
    const noteRepository = { create: jest.fn(), save: jest.fn() };
    const dataSource = { createQueryRunner: jest.fn() };

    const service = new ReservationService(
      dataSource as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      noteRepository as any
    );

    return { service };
  };

  it('throws RESERVATION_INVALID_STATE when confirming an already-CONFIRMED reservation', async () => {
    const { service } = build(ReservationStatus.CONFIRMED);

    await expect(service.confirmReservation(userId, reservationId)).rejects.toMatchObject({
      code: 'RESERVATION_INVALID_STATE'
    });
  });

  it('throws RESERVATION_INVALID_STATE when completing a CANCELLED reservation', async () => {
    const { service } = build(ReservationStatus.CANCELLED);

    await expect(service.completeReservation(userId, reservationId)).rejects.toMatchObject({
      code: 'RESERVATION_INVALID_STATE'
    });
  });

  it('throws RESERVATION_INVALID_STATE when rescheduling a COMPLETED reservation', async () => {
    const { service } = build(ReservationStatus.COMPLETED);

    await expect(
      service.rescheduleReservation(userId, reservationId, {
        new_start_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        new_end_time: new Date(Date.now() + 73 * 60 * 60 * 1000).toISOString(),
        reason: 'test'
      })
    ).rejects.toMatchObject({ code: 'RESERVATION_INVALID_STATE' });
  });
});
