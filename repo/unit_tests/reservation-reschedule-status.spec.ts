import { ReservationService } from '../src/modules/reservation/reservation.service';
import { ReservationEntity, ReservationStatus } from '../src/modules/reservation/entities/reservation.entity';

describe('ReservationService reschedule lifecycle semantics', () => {
  const reservationId = 'res-11111111-1111-4111-8111-111111111111';
  const userId = 'user-22222222-2222-4222-8222-222222222222';

  const makeReservation = (status: ReservationStatus): ReservationEntity =>
    ({
      id: reservationId,
      patientId: userId,
      providerId: userId,
      status,
      startTime: new Date('2026-09-01T10:00:00.000Z'),
      endTime: new Date('2026-09-01T11:00:00.000Z'),
      refundPercentage: null,
      refundStatus: null,
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null
    } as ReservationEntity);

  const build = (initialStatus: ReservationStatus) => {
    let storedReservation = makeReservation(initialStatus);

    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['ops_admin']),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined)
    };
    const auditService = {
      appendLog: jest.fn().mockResolvedValue(undefined)
    };
    const reservationRepository = {
      findOne: jest.fn().mockImplementation(async () => ({ ...storedReservation })),
      create: jest.fn((value: unknown) => value),
      save: jest.fn()
    };
    const transitionRepository = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn()
    };
    const noteRepository = {
      create: jest.fn(),
      save: jest.fn()
    };

    const manager = {
      findOne: jest.fn().mockImplementation(async () => ({ ...storedReservation })),
      save: jest.fn().mockImplementation(async (entity: unknown, value: unknown) => {
        if (entity === ReservationEntity) {
          storedReservation = {
            ...(value as ReservationEntity),
            createdAt: storedReservation.createdAt,
            updatedAt: new Date('2026-01-01T00:05:00.000Z'),
            deletedAt: null
          };
          return { ...storedReservation };
        }
        return value;
      })
    };

    const queryRunner = {
      manager,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined)
    };

    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };

    const service = new ReservationService(
      dataSource as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      noteRepository as any
    );

    return {
      service,
      transitionRepository,
      auditService
    };
  };

  it('sets reservation status to RESCHEDULED and records transition metadata', async () => {
    const { service, transitionRepository, auditService } = build(ReservationStatus.CONFIRMED);

    const result = await service.rescheduleReservation(userId, reservationId, {
      new_start_time: '2026-09-02T10:00:00.000Z',
      new_end_time: '2026-09-02T11:00:00.000Z',
      reason: 'provider requested change'
    });

    expect(result).toMatchObject({ status: ReservationStatus.RESCHEDULED });
    expect(transitionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RESCHEDULE',
        fromStatus: ReservationStatus.CONFIRMED,
        toStatus: ReservationStatus.RESCHEDULED
      })
    );
    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reservation.reschedule',
        payload: expect.objectContaining({
          access_basis: expect.any(String),
          outcome: 'success',
          filters: expect.objectContaining({
            from_status: ReservationStatus.CONFIRMED,
            to_status: ReservationStatus.RESCHEDULED
          })
        })
      })
    );
  });

  it('allows completing a RESCHEDULED reservation', async () => {
    const { service } = build(ReservationStatus.RESCHEDULED);

    const result = await service.completeReservation(userId, reservationId);

    expect(result).toMatchObject({ status: ReservationStatus.COMPLETED });
  });
});
