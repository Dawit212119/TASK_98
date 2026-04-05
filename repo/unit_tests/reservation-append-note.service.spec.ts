import { AppException } from '../src/common/exceptions/app.exception';
import { ReservationService } from '../src/modules/reservation/reservation.service';
import { ReservationEntity, ReservationStatus } from '../src/modules/reservation/entities/reservation.entity';

describe('ReservationService appendReservationNote', () => {
  const reservationId = 'res-11111111-1111-4111-8111-111111111111';
  const userId = 'user-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const baseReservation: ReservationEntity = {
    id: reservationId,
    patientId: userId,
    providerId: null,
    startTime: new Date('2026-04-10T10:00:00.000Z'),
    endTime: new Date('2026-04-10T11:00:00.000Z'),
    status: ReservationStatus.CREATED,
    refundPercentage: null,
    refundStatus: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null
  } as ReservationEntity;

  const createService = () => {
    const scopePolicyService = {
      getRoles: jest.fn(),
      assertReservationInScope: jest.fn()
    };
    const auditService = {
      appendLog: jest.fn()
    };
    const reservationRepository = {
      findOne: jest.fn()
    };
    const transitionRepository = {};
    const noteRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn()
    };

    const service = new ReservationService(
      { createQueryRunner: jest.fn() } as any,
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
      noteRepository
    };
  };

  it('persists note, audits metadata, returns 201-shaped payload', async () => {
    const { service, reservationRepository, scopePolicyService, noteRepository, auditService } = createService();
    reservationRepository.findOne.mockResolvedValue({ ...baseReservation });
    scopePolicyService.getRoles.mockResolvedValue(['patient']);
    scopePolicyService.assertReservationInScope.mockResolvedValue(undefined);

    const createdAt = new Date('2026-06-01T12:00:00.000Z');
    noteRepository.save.mockImplementation(async (row: Record<string, unknown>) => ({
      ...(row as object),
      id: 'note-uuid-1',
      createdAt,
      updatedAt: createdAt,
      version: 1
    }));

    const out = await service.appendReservationNote(userId, reservationId, { note: 'Post-visit clarification.' });

    expect(out.note_id).toBe('note-uuid-1');
    expect(out.reservation_id).toBe(reservationId);
    expect(out.author_id).toBe(userId);
    expect(out.note).toBe('Post-visit clarification.');
    expect(out.version).toBe(1);
    expect(out.created_at).toBe(createdAt.toISOString());

    expect(noteRepository.save).toHaveBeenCalled();
    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'reservation',
        entityId: reservationId,
        action: 'reservation.note.create',
        actorId: userId,
        payload: expect.objectContaining({
          access_basis: 'self',
          outcome: 'success',
          filters: expect.objectContaining({
            reservation_id: reservationId,
            note_id: 'note-uuid-1'
          }),
          author_id: userId,
          note_length: 'Post-visit clarification.'.length
        })
      })
    );
  });

  it('throws NOT_FOUND 404 when reservation does not exist', async () => {
    const { service, reservationRepository, scopePolicyService } = createService();
    reservationRepository.findOne.mockResolvedValue(null);

    try {
      await service.appendReservationNote(userId, reservationId, { note: 'x' });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe('NOT_FOUND');
      expect((e as AppException).getStatus()).toBe(404);
    }

    expect(scopePolicyService.assertReservationInScope).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN 403 when reservation is out of scope', async () => {
    const { service, reservationRepository, scopePolicyService } = createService();
    reservationRepository.findOne.mockResolvedValue({ ...baseReservation });
    scopePolicyService.getRoles.mockResolvedValue(['patient']);
    scopePolicyService.assertReservationInScope.mockRejectedValue(
      new AppException('FORBIDDEN', 'Reservation is out of scope', { reservation_id: reservationId }, 403)
    );

    try {
      await service.appendReservationNote('other-user', reservationId, { note: 'nope' });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe('FORBIDDEN');
      expect((e as AppException).getStatus()).toBe(403);
    }
  });
});
