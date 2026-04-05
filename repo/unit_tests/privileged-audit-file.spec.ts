import { FileService } from '../src/modules/file/file.service';

describe('FileService privileged audit – identity document read', () => {
  const buildService = () => {
    const configService = { get: jest.fn(() => 'test-key') };
    const reservationService = {
      ensureReservationForAttachment: jest.fn(),
      isOpsAdmin: jest.fn()
    };
    const scopePolicyService = {
      getRoles: jest.fn(),
      assertReservationInScope: jest.fn()
    };
    const auditService = { appendLog: jest.fn(async () => ({ id: 'audit-1' })) };
    const fileRepository = { findOne: jest.fn(), count: jest.fn() };
    const identityDocumentRepository = {
      findOne: jest.fn(),
      create: jest.fn((p: unknown) => p),
      save: jest.fn()
    };

    const service = new FileService(
      configService as any,
      reservationService as any,
      scopePolicyService as any,
      auditService as any,
      fileRepository as any,
      identityDocumentRepository as any
    );

    return { service, configService, reservationService, scopePolicyService, auditService, fileRepository, identityDocumentRepository };
  };

  const stubDocument = {
    id: 'doc-1',
    ownerUserId: 'owner-1',
    documentType: 'passport',
    encryptedDocumentNumber: 'enc',
    encryptionIv: 'iv',
    encryptionAuthTag: 'tag',
    documentNumberLast4: '1234',
    country: 'US',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    version: 1
  };

  it('emits audit record when owner reads own identity document (self access)', async () => {
    const { service, scopePolicyService, auditService, identityDocumentRepository } = buildService();
    identityDocumentRepository.findOne.mockResolvedValue(stubDocument);
    scopePolicyService.getRoles.mockResolvedValue(['patient']);

    await service.getIdentityDocument('owner-1', 'doc-1');

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'identity_document.read',
        actorId: 'owner-1',
        entityType: 'identity_document',
        entityId: 'doc-1',
        payload: expect.objectContaining({
          access_basis: 'self',
          outcome: 'success',
          filters: {}
        })
      })
    );
  });

  it('emits audit record when ops_admin reads identity document (privileged access)', async () => {
    const { service, scopePolicyService, auditService, identityDocumentRepository } = buildService();
    identityDocumentRepository.findOne.mockResolvedValue(stubDocument);
    scopePolicyService.getRoles.mockResolvedValue(['ops_admin']);

    await service.getIdentityDocument('admin-1', 'doc-1');

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'identity_document.read',
        actorId: 'admin-1',
        entityType: 'identity_document',
        entityId: 'doc-1',
        payload: expect.objectContaining({
          access_basis: 'ops_admin',
          outcome: 'success',
          filters: {}
        })
      })
    );
  });

  it('does NOT emit audit record when access is denied (forbidden)', async () => {
    const { service, scopePolicyService, auditService, identityDocumentRepository } = buildService();
    identityDocumentRepository.findOne.mockResolvedValue(stubDocument);
    scopePolicyService.getRoles.mockResolvedValue(['staff']);

    await expect(service.getIdentityDocument('other-user', 'doc-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(auditService.appendLog).not.toHaveBeenCalled();
  });

  it('does NOT emit audit record when document not found', async () => {
    const { service, auditService, identityDocumentRepository } = buildService();
    identityDocumentRepository.findOne.mockResolvedValue(null);

    await expect(service.getIdentityDocument('owner-1', 'doc-999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(auditService.appendLog).not.toHaveBeenCalled();
  });
});

describe('FileService privileged audit – prepareDownload', () => {
  const buildService = () => {
    const configService = { get: jest.fn(() => '/tmp/uploads') };
    const reservationService = {
      ensureReservationForAttachment: jest.fn(),
      isOpsAdmin: jest.fn()
    };
    const scopePolicyService = {
      getRoles: jest.fn(),
      assertReservationInScope: jest.fn()
    };
    const auditService = { appendLog: jest.fn(async () => ({ id: 'audit-1' })) };
    const fileRepository = { findOne: jest.fn(), count: jest.fn() };
    const identityDocumentRepository = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };

    const service = new FileService(
      configService as any,
      reservationService as any,
      scopePolicyService as any,
      auditService as any,
      fileRepository as any,
      identityDocumentRepository as any
    );

    return { service, reservationService, scopePolicyService, auditService, fileRepository };
  };

  const stubFile = {
    id: 'file-1',
    reservationId: 'res-1',
    uploaderId: 'user-1',
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    storageKey: 'abc123.pdf'
  };

  it('emits audit record on successful file download preparation', async () => {
    const { service, reservationService, scopePolicyService, auditService, fileRepository } = buildService();
    fileRepository.findOne.mockResolvedValue(stubFile);
    reservationService.ensureReservationForAttachment.mockResolvedValue({ id: 'res-1' });
    scopePolicyService.assertReservationInScope.mockResolvedValue(undefined);
    scopePolicyService.getRoles.mockResolvedValue(['staff']);

    // Mock fs.stat to succeed and createReadStream
    const fs = require('node:fs/promises');
    const fsSync = require('node:fs');
    jest.spyOn(fs, 'stat').mockResolvedValue({} as any);
    jest.spyOn(fsSync, 'createReadStream').mockReturnValue('mock-stream' as any);

    const result = await service.prepareDownload('staff-1', 'file-1');

    expect(auditService.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reservation.file.download',
        actorId: 'staff-1',
        entityType: 'reservation_file',
        entityId: 'file-1',
        payload: expect.objectContaining({
          access_basis: 'staff',
          outcome: 'success',
          filters: { reservation_id: 'res-1' }
        })
      })
    );

    jest.restoreAllMocks();
  });

  it('does NOT emit audit record when file is not found', async () => {
    const { service, auditService, fileRepository } = buildService();
    fileRepository.findOne.mockResolvedValue(null);

    await expect(service.prepareDownload('user-1', 'missing-file')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(auditService.appendLog).not.toHaveBeenCalled();
  });
});
