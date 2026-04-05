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
    const noteRepository = { create: jest.fn((x: unknown) => x), save: jest.fn() };

    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    const managerSave = jest.fn(async (_EntityClass: unknown, row: any) =>
      Object.assign(row, {
        id: row.id ?? 'res-new-1',
        status: row.status ?? ReservationStatus.CREATED,
        version: row.version ?? 1,
        createdAt,
        updatedAt: createdAt,
        refundPercentage: null,
        refundStatus: null,
        deletedAt: null
      })
    );

    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: { save: managerSave }
    };

    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };

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
      transitionRepository,
      noteRepository,
      queryRunner,
      managerSave
    };
  };

  it('rejects patient with foreign patient_id (403)', async () => {
    const { service, scopePolicyService, queryRunner } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient']);

    await expect(
      service.createReservation(patientUserId, { patient_id: otherPatientId, ...payloadWindow })
    ).rejects.toMatchObject({
      code: 'RESERVATION_PATIENT_SELF_ONLY'
    });

    // Transaction should not have been started for pre-validation failures
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('allows patient omitting patient_id (uses caller)', async () => {
    const { service, scopePolicyService, queryRunner, managerSave } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient']);

    const out = await service.createReservation(patientUserId, { ...payloadWindow });

    expect(out.patient_id).toBe(patientUserId);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    // manager.save called for reservation + transition = 2 times minimum
    expect(managerSave).toHaveBeenCalled();
  });

  it('allows patient with explicit patient_id equal to caller', async () => {
    const { service, scopePolicyService } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient']);

    const out = await service.createReservation(patientUserId, { patient_id: patientUserId, ...payloadWindow });

    expect(out.patient_id).toBe(patientUserId);
  });

  it('allows staff to set explicit patient_id', async () => {
    const { service, scopePolicyService } = build();
    scopePolicyService.getRoles.mockResolvedValue(['staff']);

    const out = await service.createReservation('staff-user-id', { patient_id: otherPatientId, ...payloadWindow });

    expect(out.patient_id).toBe(otherPatientId);
  });

  it('allows ops_admin to set explicit patient_id', async () => {
    const { service, scopePolicyService } = build();
    scopePolicyService.getRoles.mockResolvedValue(['ops_admin']);

    const out = await service.createReservation('ops-user-id', { patient_id: otherPatientId, ...payloadWindow });

    expect(out.patient_id).toBe(otherPatientId);
  });

  it('allows patient+staff to set explicit patient_id for another user', async () => {
    const { service, scopePolicyService } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient', 'staff']);

    const out = await service.createReservation(patientUserId, { patient_id: otherPatientId, ...payloadWindow });
    expect(out.patient_id).toBe(otherPatientId);
  });

  it('rolls back transaction when scope assignment fails (staff with no scopes)', async () => {
    const { service, scopePolicyService, queryRunner, auditService } = build();
    scopePolicyService.getRoles.mockResolvedValue(['staff']);
    scopePolicyService.assignReservationDefaultScopeFromActor.mockRejectedValue(
      Object.assign(new Error('Staff or merchant must be mapped to at least one data scope'), {
        code: 'RESERVATION_SCOPE_REQUIRED',
        statusCode: 422
      })
    );

    await expect(
      service.createReservation('staff-no-scope', { patient_id: otherPatientId, ...payloadWindow })
    ).rejects.toMatchObject({ code: 'RESERVATION_SCOPE_REQUIRED' });

    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(auditService.appendLog).not.toHaveBeenCalled();
  });

  it('rolls back transaction when ensureDefaultClinicReservationScope fails', async () => {
    const { service, scopePolicyService, queryRunner, auditService } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient']);
    scopePolicyService.ensureDefaultClinicReservationScope.mockRejectedValue(new Error('DB error'));

    await expect(
      service.createReservation(patientUserId, { ...payloadWindow })
    ).rejects.toThrow('DB error');

    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(auditService.appendLog).not.toHaveBeenCalled();
  });

  it('saves note within transaction when provided', async () => {
    const { service, scopePolicyService, managerSave, noteRepository } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient']);

    await service.createReservation(patientUserId, { ...payloadWindow, notes: 'Important note' });

    // manager.save called 3 times: reservation, note, transition
    expect(managerSave).toHaveBeenCalledTimes(3);
    expect(noteRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'Important note', authorId: patientUserId })
    );
  });

  it('emits audit log after successful commit', async () => {
    const { service, scopePolicyService, auditService, queryRunner } = build();
    scopePolicyService.getRoles.mockResolvedValue(['patient']);

    await service.createReservation(patientUserId, { ...payloadWindow });

    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reservation.create',
        actorId: patientUserId,
        entityType: 'reservation'
      })
    );
  });
});
