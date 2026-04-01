import { ReservationService } from '../src/modules/reservation/reservation.service';
import { ReservationEntity, ReservationStatus } from '../src/modules/reservation/entities/reservation.entity';

describe('ReservationService createReservation', () => {
  const patientUserId = 'patient-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherPatientId = 'patient-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const payloadWindow = {
    start_time: '2026-04-10T10:00:00.000Z',
    end_time: '2026-04-10T11:00:00.000Z'
  };

  const build = () => {
    const scopePolicyService = {
      getRoles: jest.fn(),
      ensureDefaultClinicReservationScope: jest.fn(),
      assignReservationDefaultScopeFromActor: jest.fn()
    };
    const auditService = { appendLog: jest.fn() };
    const reservationRepository = {
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

    return {
      service,
      scopePolicyService,
      auditService,
      reservationRepository,
      transitionRepository
    };
  };

  it('rejects patient with foreign patient_id (403)', async () => {
    const { service, reservationRepository, scopePolicyService } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient']);

    await expect(
      service.createReservation(patientUserId, { patient_id: otherPatientId, ...payloadWindow })
    ).rejects.toMatchObject({
      code: 'RESERVATION_PATIENT_SELF_ONLY'
    });

    expect(reservationRepository.save).not.toHaveBeenCalled();
  });

  it('allows patient omitting patient_id (uses caller)', async () => {
    const { service, scopePolicyService, reservationRepository, transitionRepository } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient']);

    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    reservationRepository.save.mockImplementation(async (row: ReservationEntity) =>
      Object.assign(row, {
        id: 'res-new-1',
        status: ReservationStatus.CREATED,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        refundPercentage: null,
        refundStatus: null,
        deletedAt: null
      })
    );

    const out = await service.createReservation(patientUserId, { ...payloadWindow });

    expect(out.patient_id).toBe(patientUserId);
    expect(reservationRepository.save).toHaveBeenCalled();
    expect(transitionRepository.save).toHaveBeenCalled();
  });

  it('allows patient with explicit patient_id equal to caller', async () => {
    const { service, scopePolicyService, reservationRepository } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient']);

    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    reservationRepository.save.mockImplementation(async (row: ReservationEntity) =>
      Object.assign(row, {
        id: 'res-new-2',
        status: ReservationStatus.CREATED,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        refundPercentage: null,
        refundStatus: null,
        deletedAt: null
      })
    );

    const out = await service.createReservation(patientUserId, { patient_id: patientUserId, ...payloadWindow });

    expect(out.patient_id).toBe(patientUserId);
  });

  it('allows staff to set explicit patient_id', async () => {
    const { service, scopePolicyService, reservationRepository } = build();
    scopePolicyService.getRoles.mockResolvedValue(['staff']);

    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    reservationRepository.save.mockImplementation(async (row: ReservationEntity) =>
      Object.assign(row, {
        id: 'res-staff-1',
        status: ReservationStatus.CREATED,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        refundPercentage: null,
        refundStatus: null,
        deletedAt: null
      })
    );

    const out = await service.createReservation('staff-user-id', { patient_id: otherPatientId, ...payloadWindow });

    expect(out.patient_id).toBe(otherPatientId);
  });

  it('allows ops_admin to set explicit patient_id', async () => {
    const { service, scopePolicyService, reservationRepository } = build();
    scopePolicyService.getRoles.mockResolvedValue(['ops_admin']);

    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    reservationRepository.save.mockImplementation(async (row: ReservationEntity) =>
      Object.assign(row, {
        id: 'res-ops-1',
        status: ReservationStatus.CREATED,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        refundPercentage: null,
        refundStatus: null,
        deletedAt: null
      })
    );

    const out = await service.createReservation('ops-user-id', { patient_id: otherPatientId, ...payloadWindow });

    expect(out.patient_id).toBe(otherPatientId);
  });

  it('allows patient+staff to set explicit patient_id for another user', async () => {
    const { service, scopePolicyService, reservationRepository } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient', 'staff']);

    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    reservationRepository.save.mockImplementation(async (row: ReservationEntity) =>
      Object.assign(row, {
        id: 'res-dual-1',
        status: ReservationStatus.CREATED,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        refundPercentage: null,
        refundStatus: null,
        deletedAt: null
      })
    );

    const out = await service.createReservation(patientUserId, { patient_id: otherPatientId, ...payloadWindow });
    expect(out.patient_id).toBe(otherPatientId);
  });
});
