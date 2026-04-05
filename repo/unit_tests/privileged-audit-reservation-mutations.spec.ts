import { ReservationService } from '../src/modules/reservation/reservation.service';
import { ReservationEntity, ReservationStatus } from '../src/modules/reservation/entities/reservation.entity';

describe('ReservationService privileged audit — mutations and read', () => {
  const reservationId = 'res-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const providerUserId = 'user-providr-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const patientUserId = 'user-patien-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const baseReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity =>
    ({
      id: reservationId,
      patientId: patientUserId,
      providerId: providerUserId,
      status: ReservationStatus.CREATED,
      startTime: new Date(Date.now() + 48 * 60 * 60 * 1000),
      endTime: new Date(Date.now() + 49 * 60 * 60 * 1000),
      refundPercentage: null,
      refundStatus: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides
    }) as ReservationEntity;

  const buildQr = (locked: ReservationEntity) => {
    const manager = {
      findOne: jest.fn(async () => ({ ...locked })),
      save: jest.fn(async (_e: unknown, entity: ReservationEntity) => ({ ...entity }))
    };
    return {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager
    };
  };

  const buildServiceForConfirm = () => {
    const res = baseReservation();
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['provider']),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined)
    };
    const reservationRepository = {
      findOne: jest.fn().mockResolvedValue(res),
      createQueryBuilder: jest.fn()
    };
    const transitionRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn()
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => buildQr(res))
    };

    const service = new ReservationService(
      dataSource as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      {} as any
    );

    return { service, auditService };
  };

  it('confirmReservation emits standardized privileged audit payload', async () => {
    const { service, auditService } = buildServiceForConfirm();

    await service.confirmReservation(providerUserId, reservationId);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reservation.confirm',
        actorId: providerUserId,
        entityType: 'reservation',
        entityId: reservationId,
        payload: expect.objectContaining({
          access_basis: 'provider',
          outcome: 'success',
          filters: expect.objectContaining({
            reservation_id: reservationId,
            from_status: ReservationStatus.CREATED,
            to_status: ReservationStatus.CONFIRMED
          })
        })
      })
    );
  });

  const buildServiceForCancel = () => {
    const res = baseReservation({ status: ReservationStatus.CONFIRMED });
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['patient']),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined)
    };
    const reservationRepository = {
      findOne: jest.fn().mockResolvedValue(res),
      createQueryBuilder: jest.fn()
    };
    const transitionRepository = { create: jest.fn((x: unknown) => x), save: jest.fn() };
    const dataSource = { createQueryRunner: jest.fn(() => buildQr(res)) };

    const service = new ReservationService(
      dataSource as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      {} as any
    );

    return { service, auditService };
  };

  it('cancelReservation emits standardized privileged audit payload', async () => {
    const { service, auditService } = buildServiceForCancel();

    await service.cancelReservation(patientUserId, reservationId, { reason: 'patient cancel' });

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reservation.cancel',
        actorId: patientUserId,
        payload: expect.objectContaining({
          access_basis: 'self',
          outcome: 'success',
          filters: expect.objectContaining({
            reservation_id: reservationId,
            to_status: ReservationStatus.CANCELLED
          })
        })
      })
    );
  });

  const buildServiceForComplete = () => {
    const res = baseReservation({ status: ReservationStatus.CONFIRMED });
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['staff']),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined)
    };
    const reservationRepository = {
      findOne: jest.fn().mockResolvedValue(res),
      createQueryBuilder: jest.fn()
    };
    const transitionRepository = { create: jest.fn((x: unknown) => x), save: jest.fn() };
    const dataSource = { createQueryRunner: jest.fn(() => buildQr(res)) };

    const service = new ReservationService(
      dataSource as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      {} as any
    );

    return { service, auditService };
  };

  it('completeReservation emits standardized privileged audit payload', async () => {
    const { service, auditService } = buildServiceForComplete();

    await service.completeReservation(providerUserId, reservationId);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reservation.complete',
        actorId: providerUserId,
        payload: expect.objectContaining({
          access_basis: 'staff',
          outcome: 'success',
          filters: expect.objectContaining({
            reservation_id: reservationId,
            to_status: ReservationStatus.COMPLETED
          })
        })
      })
    );
  });

  it('getReservationById emits privileged read audit on success', async () => {
    const res = baseReservation({ status: ReservationStatus.CONFIRMED });
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['merchant']),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined)
    };
    const reservationRepository = { findOne: jest.fn().mockResolvedValue(res) };
    const service = new ReservationService(
      { createQueryRunner: jest.fn() } as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      {} as any,
      {} as any
    );

    await service.getReservationById('merchant-user', reservationId);

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reservation.read',
        actorId: 'merchant-user',
        entityType: 'reservation',
        entityId: reservationId,
        payload: expect.objectContaining({
          access_basis: 'merchant',
          outcome: 'success',
          filters: expect.objectContaining({ reservation_id: reservationId })
        })
      })
    );
  });
});
