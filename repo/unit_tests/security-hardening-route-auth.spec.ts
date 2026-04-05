/**
 * Security Hardening — Route-level and Function-level Authorization Consistency
 *
 * Tests that:
 * A) All privileged operations enforce role/permission checks at function entry.
 * B) Previously plain audit calls now emit standardized privileged audit payloads.
 * C) Analytics event ingestion requires proper authorization.
 */

import { AppException } from '../src/common/exceptions/app.exception';
import { assertPrivilegedAuditPayload } from '../src/modules/audit/privileged-audit.builder';

/* ─── Analytics ingestEvent authorization ─────────────────────────── */

describe('AnalyticsEventService — ingestEvent authorization (A)', () => {
  const buildService = (opts: { roles?: string[]; permissions?: string[] } = {}) => {
    const roles = opts.roles ?? [];
    const permissions = opts.permissions ?? [];
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const accessControlService = {
      getUserPermissions: jest.fn(async () => permissions),
      getUserRoleNames: jest.fn(async () => roles),
    };
    const eventRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (entity: any) => ({
        ...entity,
        id: 'evt-1',
        version: 1,
        occurredAt: new Date('2026-04-01T00:00:00.000Z'),
      })),
      createQueryBuilder: jest.fn(),
    };

    // Inline require to construct the service
    const { AnalyticsEventService } = require('../src/modules/analytics/analytics-event.service');
    const service = new AnalyticsEventService(accessControlService, auditService, eventRepository);
    return { service, auditService, eventRepository };
  };

  const basePayload = {
    event_type: 'impression',
    subject_type: 'content',
    subject_id: 'content-1',
    occurred_at: '2026-04-01T00:00:00.000Z',
    metadata: {},
  };

  it('denies ingestEvent when user has no analytics permission or ops_admin role', async () => {
    const { service } = buildService({ roles: ['patient'], permissions: [] });
    await expect(service.ingestEvent('user-1', basePayload)).rejects.toThrow(AppException);
    try {
      await service.ingestEvent('user-1', basePayload);
    } catch (err: any) {
      expect(err.status).toBe(403);
    }
  });

  it('allows ingestEvent with analytics.api.use permission', async () => {
    const { service, eventRepository } = buildService({ permissions: ['analytics.api.use'] });
    const result = await service.ingestEvent('user-1', basePayload);
    expect(result).toBeDefined();
    expect(result.event_id).toBe('evt-1');
    expect(eventRepository.save).toHaveBeenCalled();
  });

  it('allows ingestEvent for ops_admin without analytics permission', async () => {
    const { service, eventRepository } = buildService({ roles: ['ops_admin'], permissions: [] });
    const result = await service.ingestEvent('user-1', basePayload);
    expect(result).toBeDefined();
    expect(eventRepository.save).toHaveBeenCalled();
  });

  it('allows ingestEvent for system user (internal pipeline)', async () => {
    const { service, eventRepository } = buildService({ roles: [], permissions: [] });
    const result = await service.ingestEvent('system', basePayload);
    expect(result).toBeDefined();
    expect(eventRepository.save).toHaveBeenCalled();
  });

  // Table-driven: role combinations that should be denied
  const deniedRoleCombinations = [
    { roles: ['patient'], permissions: [], label: 'patient only' },
    { roles: ['merchant'], permissions: [], label: 'merchant only' },
    { roles: ['provider'], permissions: [], label: 'provider only' },
    { roles: ['staff'], permissions: [], label: 'staff only (no analytics perm)' },
    { roles: ['patient', 'merchant'], permissions: [], label: 'patient+merchant' },
  ];

  it.each(deniedRoleCombinations)(
    'denies ingestEvent for $label',
    async ({ roles, permissions }) => {
      const { service } = buildService({ roles, permissions });
      await expect(service.ingestEvent('user-1', basePayload)).rejects.toThrow(AppException);
    }
  );
});

/* ─── Reservation privileged audit consistency (C) ────────────────── */

describe('ReservationService — privileged audit on create/note/reschedule (C)', () => {
  const { ReservationService } = require('../src/modules/reservation/reservation.service');
  const { ReservationStatus } = require('../src/modules/reservation/entities/reservation.entity');

  const reservationId = 'res-sec-harden-0001';
  const patientUserId = 'patient-sec-01';
  const providerUserId = 'provider-sec-01';

  const baseReservation = (overrides: Record<string, unknown> = {}) => ({
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
    ...overrides,
  });

  const buildServiceForCreate = (roles: string[]) => {
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(roles),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined),
      ensureDefaultClinicReservationScope: jest.fn().mockResolvedValue(undefined),
      assignReservationDefaultScopeFromActor: jest.fn().mockResolvedValue(undefined),
    };
    const res = baseReservation();
    const reservationRepository = {
      findOne: jest.fn().mockResolvedValue(res),
      create: jest.fn((x: unknown) => x),
      createQueryBuilder: jest.fn(),
    };
    const transitionRepository = { create: jest.fn((x: unknown) => x), save: jest.fn() };
    const noteRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (entity: any) => ({
        ...entity,
        id: 'note-1',
        createdAt: new Date(),
        version: 1,
        note: entity.note ?? 'test',
      })),
    };

    const qr = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest.fn(async (_entity: unknown, data: any) => ({ ...data, id: reservationId, createdAt: new Date(), updatedAt: new Date(), version: 1, startTime: data?.startTime ?? res.startTime, endTime: data?.endTime ?? res.endTime })),
        findOne: jest.fn(async () => ({ ...res })),
      },
    };
    const dataSource = { createQueryRunner: jest.fn(() => qr) };

    const service = new ReservationService(
      dataSource as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      noteRepository as any,
    );

    return { service, auditService };
  };

  it('createReservation emits privileged audit with access_basis, outcome, and filters', async () => {
    const { service, auditService } = buildServiceForCreate(['patient']);
    await service.createReservation(patientUserId, {
      patient_id: patientUserId,
      provider_id: providerUserId,
      start_time: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      end_time: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
    });

    expect(auditService.appendLog).toHaveBeenCalled();
    const payload = (auditService.appendLog.mock.calls as any[])[0][0];
    expect(payload.action).toBe('reservation.create');
    expect(payload.payload).toBeDefined();
    assertPrivilegedAuditPayload(payload.payload);
    expect(payload.payload.access_basis).toBe('self');
    expect(payload.payload.outcome).toBe('success');
  });

  it('appendReservationNote emits privileged audit payload', async () => {
    const { service, auditService } = buildServiceForCreate(['patient']);
    await service.appendReservationNote(patientUserId, reservationId, { note: 'test note' });

    const calls = auditService.appendLog.mock.calls as any[];
    const noteCall = calls.find((c: any) => c[0].action === 'reservation.note.create');
    expect(noteCall).toBeDefined();
    const notePayload = noteCall[0];
    assertPrivilegedAuditPayload(notePayload.payload);
    expect(notePayload.payload.access_basis).toBeDefined();
    expect(notePayload.payload.outcome).toBe('success');
  });

  it('rescheduleReservation emits privileged audit payload', async () => {
    const res = baseReservation({ status: ReservationStatus.CONFIRMED });
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const scopePolicyService = {
      getRoles: jest.fn().mockResolvedValue(['ops_admin']),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined),
    };
    const reservationRepository = {
      findOne: jest.fn().mockResolvedValue(res),
      createQueryBuilder: jest.fn(),
    };
    const transitionRepository = { create: jest.fn((x: unknown) => x), save: jest.fn() };
    const qr = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest.fn(async (_e: unknown, entity: any) => ({ ...entity })),
        findOne: jest.fn(async () => ({ ...res })),
      },
    };
    const dataSource = { createQueryRunner: jest.fn(() => qr) };

    const service = new ReservationService(
      dataSource as any,
      scopePolicyService as any,
      auditService as any,
      reservationRepository as any,
      transitionRepository as any,
      {} as any,
    );

    await service.rescheduleReservation('admin-user', reservationId, {
      new_start_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      new_end_time: new Date(Date.now() + 73 * 60 * 60 * 1000).toISOString(),
      reason: 'patient request',
    });

    expect(auditService.appendLog).toHaveBeenCalled();
    const payload = (auditService.appendLog.mock.calls as any[])[0][0];
    expect(payload.action).toBe('reservation.reschedule');
    assertPrivilegedAuditPayload(payload.payload);
    expect(payload.payload.access_basis).toBe('ops_admin');
    expect(payload.payload.outcome).toBe('success');
  });
});

/* ─── Workflow privileged audit consistency (C) ───────────────────── */

describe('WorkflowService — privileged audit on create/submit (C)', () => {
  const { WorkflowService } = require('../src/modules/workflow/workflow.service');

  const buildService = (roles: string[]) => {
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const accessControlService = {
      getUserRoleNames: jest.fn(async () => roles),
    };
    const workflowBusinessTimeService = {
      calculateDeadlineAt: jest.fn(() => new Date(Date.now() + 48 * 60 * 60 * 1000)),
    };
    const definitionRepository = {
      create: jest.fn((x: unknown) => x),
      findOne: jest.fn(async () => ({
        id: 'wf-def-1',
        approvalMode: 'ANY_ONE',
        slaHours: 48,
        active: true,
        deletedAt: null,
      })),
    };
    const stepRepository = {
      create: jest.fn((x: unknown) => x),
      find: jest.fn(async () => [
        { id: 'step-1', order: 1, approverRole: 'ops_admin', conditions: {}, deletedAt: null },
      ]),
    };
    const requestRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (entity: any) => ({
        ...entity,
        id: 'wf-req-1',
        version: 1,
        updatedAt: new Date(),
        deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      })),
    };
    const approvalRepository = {};

    const qr = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest.fn(async (_e: unknown, entity: any) => {
          if (Array.isArray(entity)) {
            return entity.map((e: any) => ({ ...e, id: e.id ?? 'step-1' }));
          }
          return {
            ...entity,
            id: entity.id ?? 'wf-def-1',
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }),
      },
    };
    const dataSource = { createQueryRunner: jest.fn(() => qr) };

    const service = new WorkflowService(
      dataSource as any,
      accessControlService as any,
      workflowBusinessTimeService as any,
      auditService as any,
      definitionRepository as any,
      stepRepository as any,
      requestRepository as any,
      approvalRepository as any,
    );

    return { service, auditService };
  };

  it('createDefinition emits privileged audit with ops_admin access_basis', async () => {
    const { service, auditService } = buildService(['ops_admin']);
    await service.createDefinition('admin-user', {
      name: 'Test Workflow',
      approval_mode: 'ANY_ONE',
      sla_hours: 48,
      steps: [{ order: 1, approver_role: 'ops_admin' }],
    });

    expect(auditService.appendLog).toHaveBeenCalled();
    const payload = (auditService.appendLog.mock.calls as any[])[0][0];
    expect(payload.action).toBe('workflow.definition.create');
    assertPrivilegedAuditPayload(payload.payload);
    expect(payload.payload.access_basis).toBe('ops_admin');
    expect(payload.payload.outcome).toBe('success');
  });

  it('submitRequest emits privileged audit with staff access_basis', async () => {
    const { service, auditService } = buildService(['staff']);
    await service.submitRequest('staff-user', {
      workflow_definition_id: 'wf-def-1',
      resource_type: 'reservation',
      resource_ref: 'res-1',
      payload: {},
    });

    const calls = auditService.appendLog.mock.calls as any[];
    const submitCall = calls.find((c: any) => c[0].action === 'workflow.request.create');
    expect(submitCall).toBeDefined();
    assertPrivilegedAuditPayload(submitCall[0].payload);
    expect(submitCall[0].payload.access_basis).toBe('staff');
  });
});

/* ─── Trust-rating privileged audit consistency (C) ───────────────── */

describe('TrustRatingService — privileged audit on review/appeal (C)', () => {
  const { TrustRatingService } = require('../src/modules/trust-rating/trust-rating.service');
  const { ReservationStatus } = require('../src/modules/reservation/entities/reservation.entity');

  const reservationId = 'res-trust-001';
  const patientUserId = 'patient-trust-01';
  const providerUserId = 'provider-trust-01';

  const buildService = (roles: string[]) => {
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const accessControlService = {
      getUserRoleNames: jest.fn(async () => roles),
    };
    const scopePolicyService = {
      getRoles: jest.fn(async () => roles),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined),
      getUserScopeIds: jest.fn(async () => []),
    };

    const reservation = {
      id: reservationId,
      patientId: patientUserId,
      providerId: providerUserId,
      status: ReservationStatus.COMPLETED,
      updatedAt: new Date(),
      deletedAt: null,
    };

    const reservationRepository = {
      findOne: jest.fn(async () => reservation),
      createQueryBuilder: jest.fn(),
    };
    const transitionRepository = {
      findOne: jest.fn(async () => ({
        createdAt: new Date(Date.now() - 60 * 1000), // 1 min ago — within window
      })),
    };
    const reviewRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (entity: any) => ({
        ...entity,
        id: 'review-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      })),
      findOne: jest.fn(async ({ where }: any) => {
        if (where?.reviewerUserId && where?.targetUserId) return null; // no duplicate
        return {
          id: 'review-for-appeal',
          targetUserId: patientUserId,
          dimensions: [{ name: 'quality', score: 1 }],
          createdAt: new Date(),
          deletedAt: null,
        };
      }),
      find: jest.fn(async () => []),
    };

    const reviewAppealRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (entity: any) => ({
        ...entity,
        id: 'appeal-1',
        createdAt: new Date(),
        version: 1,
      })),
      findOne: jest.fn(async () => null),
    };

    const appealDecisionRepository = { create: jest.fn(), save: jest.fn() };
    const creditTierRepository = { findOne: jest.fn(async () => null) };
    const fraudFlagRepository = { createQueryBuilder: jest.fn() };
    const activitySignalRepository = { save: jest.fn(), createQueryBuilder: jest.fn(), create: jest.fn((x: unknown) => x) };

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
      activitySignalRepository as any,
    );

    return { service, auditService, reviewRepository };
  };

  it('createReview emits privileged audit payload with access_basis', async () => {
    const { service, auditService } = buildService(['patient']);
    await service.createReview(patientUserId, reservationId, {
      target_user_id: providerUserId,
      dimensions: [{ name: 'quality', score: 5 }],
    });

    expect(auditService.appendLog).toHaveBeenCalled();
    const reviewCall = (auditService.appendLog.mock.calls as any[]).find(
      (c: any) => c[0].action === 'trust.review.create'
    );
    expect(reviewCall).toBeDefined();
    assertPrivilegedAuditPayload(reviewCall[0].payload);
    expect(reviewCall[0].payload.access_basis).toBe('self');
    expect(reviewCall[0].payload.outcome).toBe('success');
  });

  it('createAppeal emits privileged audit payload with self access_basis', async () => {
    const { service, auditService } = buildService(['patient']);
    await service.createAppeal(patientUserId, 'review-for-appeal', {
      reason: 'unfair review',
      evidence_files: [],
    });

    const appealCall = (auditService.appendLog.mock.calls as any[]).find(
      (c: any) => c[0].action === 'trust.appeal.create'
    );
    expect(appealCall).toBeDefined();
    assertPrivilegedAuditPayload(appealCall[0].payload);
    expect(appealCall[0].payload.access_basis).toBe('self');
  });

  it('listReservationReviews emits privileged audit payload', async () => {
    const { service, auditService } = buildService(['staff']);
    await service.listReservationReviews('staff-user', reservationId);

    const listCall = (auditService.appendLog.mock.calls as any[]).find(
      (c: any) => c[0].action === 'trust.review.list'
    );
    expect(listCall).toBeDefined();
    assertPrivilegedAuditPayload(listCall[0].payload);
    expect(listCall[0].payload.access_basis).toBe('staff');
  });
});

/* ─── File service privileged audit consistency (C) ───────────────── */

describe('FileService — privileged audit on identity doc create and file upload (C)', () => {
  const { FileService } = require('../src/modules/file/file.service');

  const buildService = (roles: string[]) => {
    const auditService = { appendLog: jest.fn(async () => ({ id: 'a1' })) };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'IDENTITY_DOC_ENCRYPTION_KEY') return 'test-key-32-chars-minimum-length!!';
        if (key === 'UPLOAD_DIR') return '/tmp/test-uploads';
        return null;
      }),
    };
    const reservationService = {
      ensureReservationForAttachment: jest.fn(async () => ({
        id: 'res-1',
        patientId: 'user-1',
      })),
      isOpsAdmin: jest.fn(async () => roles.includes('ops_admin')),
    };
    const scopePolicyService = {
      getRoles: jest.fn(async () => roles),
      assertReservationInScope: jest.fn().mockResolvedValue(undefined),
    };
    const fileRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (entity: any) => ({
        ...entity,
        id: 'file-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
        filename: entity.filename ?? 'test.pdf',
        sizeBytes: entity.sizeBytes ?? 1024,
        storageKey: entity.storageKey ?? 'key',
      })),
      count: jest.fn(async () => 0),
      findAndCount: jest.fn(async () => [[], 0]),
      findOne: jest.fn(async () => null),
    };
    const identityDocumentRepository = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (entity: any) => ({
        ...entity,
        id: 'idoc-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
        documentNumberLast4: '1234',
      })),
    };

    const service = new FileService(
      configService as any,
      reservationService as any,
      scopePolicyService as any,
      auditService as any,
      fileRepository as any,
      identityDocumentRepository as any,
    );

    return { service, auditService };
  };

  it('createIdentityDocument emits privileged audit with self access_basis', async () => {
    const { service, auditService } = buildService(['patient']);
    await service.createIdentityDocument('user-1', {
      document_type: 'PASSPORT',
      document_number: 'AB123456',
      country: 'US',
    });

    expect(auditService.appendLog).toHaveBeenCalled();
    const call = (auditService.appendLog.mock.calls as any[]).find(
      (c: any) => c[0].action === 'identity_document.create'
    );
    expect(call).toBeDefined();
    assertPrivilegedAuditPayload(call[0].payload);
    expect(call[0].payload.access_basis).toBe('self');
    expect(call[0].payload.outcome).toBe('success');
  });
});
