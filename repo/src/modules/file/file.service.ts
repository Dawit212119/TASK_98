import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { ScopePolicyService } from '../access-control/scope-policy.service';
import { AuditService } from '../audit/audit.service';
import { ReservationService } from '../reservation/reservation.service';
import { CreateIdentityDocumentDto } from './dto/create-identity-document.dto';
import { IdentityDocumentEntity } from './entities/identity-document.entity';
import { ReservationFileEntity } from './entities/reservation-file.entity';

const MAX_FILE_COUNT_PER_RESERVATION = 5;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

@Injectable()
export class FileService {
  constructor(
    private readonly configService: ConfigService,
    private readonly reservationService: ReservationService,
    private readonly scopePolicyService: ScopePolicyService,
    private readonly auditService: AuditService,
    @InjectRepository(ReservationFileEntity)
    private readonly fileRepository: Repository<ReservationFileEntity>,
    @InjectRepository(IdentityDocumentEntity)
    private readonly identityDocumentRepository: Repository<IdentityDocumentEntity>
  ) {}

  async createIdentityDocument(userId: string, payload: CreateIdentityDocumentDto): Promise<Record<string, unknown>> {
    const normalizedNumber = payload.document_number.trim();
    if (normalizedNumber.length < 4) {
      throw new AppException('IDENTITY_DOCUMENT_INVALID_NUMBER', 'document_number must be at least 4 characters', {}, 422);
    }

    const key = this.getIdentityEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(normalizedNumber, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const entity = await this.identityDocumentRepository.save(
      this.identityDocumentRepository.create({
        ownerUserId: userId,
        documentType: payload.document_type,
        encryptedDocumentNumber: encrypted.toString('base64'),
        encryptionIv: iv.toString('hex'),
        encryptionAuthTag: authTag.toString('hex'),
        documentNumberLast4: normalizedNumber.slice(-4),
        country: payload.country?.toUpperCase() ?? null
      })
    );

    await this.auditService.appendLog({
      entityType: 'identity_document',
      entityId: entity.id,
      action: 'identity_document.create',
      actorId: userId,
      payload: {
        document_type: entity.documentType,
        country: entity.country
      }
    });

    return this.toIdentityDocumentDto(entity);
  }

  async getIdentityDocument(userId: string, documentId: string): Promise<Record<string, unknown>> {
    const document = await this.identityDocumentRepository.findOne({ where: { id: documentId, deletedAt: IsNull() } });
    if (!document) {
      throw new AppException('NOT_FOUND', 'Identity document not found', { document_id: documentId }, 404);
    }

    const roles = await this.scopePolicyService.getRoles(userId);
    const canRead = roles.includes('ops_admin') || document.ownerUserId === userId;
    if (!canRead) {
      throw new AppException('FORBIDDEN', 'Identity document is out of scope', { document_id: documentId }, 403);
    }

    return this.toIdentityDocumentDto(document);
  }

  async uploadReservationAttachment(
    userId: string,
    reservationId: string,
    file: Express.Multer.File | undefined,
    label?: string
  ): Promise<Record<string, unknown>> {
    await this.reservationService.ensureReservationForAttachment(userId, reservationId);

    if (!file) {
      throw new AppException('FILE_REQUIRED', 'File is required', {}, 422);
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Only PDF, JPG, or PNG files are allowed', {}, 422);
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new AppException('FILE_TOO_LARGE', 'File size exceeds 10 MB', {}, 422);
    }

    const fileCount = await this.fileRepository.count({ where: { reservationId, deletedAt: IsNull() } });
    if (fileCount >= MAX_FILE_COUNT_PER_RESERVATION) {
      throw new AppException('FILE_LIMIT_EXCEEDED', 'Maximum 5 files per reservation', {}, 422);
    }

    const uploadDir = this.getUploadDir();
    await mkdir(uploadDir, { recursive: true });

    const sanitizedExt = extname(file.originalname) || this.defaultExtForMime(file.mimetype);
    const storageKey = `${randomUUID()}${sanitizedExt.toLowerCase()}`;
    const fullPath = join(uploadDir, storageKey);

    await writeFile(fullPath, file.buffer);

    const entity = await this.fileRepository.save(
      this.fileRepository.create({
        reservationId,
        uploaderId: userId,
        filename: basename(file.originalname),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        label: label ?? null
      })
    );

    await this.auditService.appendLog({
      entityType: 'reservation_file',
      entityId: entity.id,
      action: 'reservation.file.upload',
      actorId: userId,
      payload: {
        reservation_id: reservationId,
        filename: entity.filename,
        size_bytes: entity.sizeBytes
      }
    });

    return this.toAttachmentDto(entity, true);
  }

  async listReservationAttachments(
    userId: string,
    reservationId: string,
    query: { page: number; page_size: number }
  ): Promise<Record<string, unknown>> {
    await this.reservationService.ensureReservationForAttachment(userId, reservationId);
    const isOpsAdmin = await this.reservationService.isOpsAdmin(userId);

    const [items, total] = await this.fileRepository.findAndCount({
      where: { reservationId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size
    });

    return {
      items: items.map((item) => this.toAttachmentDto(item, isOpsAdmin)),
      page: query.page,
      page_size: query.page_size,
      total
    };
  }

  async prepareDownload(userId: string, fileId: string): Promise<{
    stream: NodeJS.ReadableStream;
    mimeType: string;
    filename: string;
  }> {
    const file = await this.fileRepository.findOne({ where: { id: fileId, deletedAt: IsNull() } });
    if (!file) {
      throw new AppException('NOT_FOUND', 'File not found', { file_id: fileId }, 404);
    }

    const reservation = await this.reservationService.ensureReservationForAttachment(userId, file.reservationId);
    await this.scopePolicyService.assertReservationInScope(userId, reservation);

    const fullPath = join(this.getUploadDir(), file.storageKey);
    try {
      await stat(fullPath);
    } catch {
      throw new AppException('FILE_NOT_AVAILABLE', 'File content is not available', { file_id: fileId }, 404);
    }

    return {
      stream: createReadStream(fullPath),
      mimeType: file.mimeType,
      filename: file.filename
    };
  }

  private toAttachmentDto(entity: ReservationFileEntity, includeStorageKey: boolean): Record<string, unknown> {
    return {
      file_id: entity.id,
      reservation_id: entity.reservationId,
      filename: entity.filename,
      mime_type: entity.mimeType,
      size_bytes: entity.sizeBytes,
      storage_key: includeStorageKey ? entity.storageKey : 'masked',
      label: entity.label,
      version: entity.version,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString()
    };
  }

  private getUploadDir(): string {
    return this.configService.get<string>('UPLOAD_DIR') ?? '/uploads';
  }

  private defaultExtForMime(mimeType: string): string {
    if (mimeType === 'application/pdf') {
      return '.pdf';
    }
    if (mimeType === 'image/png') {
      return '.png';
    }
    return '.jpg';
  }

  private getIdentityEncryptionKey(): Buffer {
    const configured = this.configService.get<string>('IDENTITY_DOC_ENCRYPTION_KEY');
    if (!configured) {
      throw new AppException('IDENTITY_DOC_ENCRYPTION_KEY_MISSING', 'IDENTITY_DOC_ENCRYPTION_KEY is required', {}, 500);
    }

    return createHash('sha256').update(configured).digest();
  }

  private toIdentityDocumentDto(entity: IdentityDocumentEntity): Record<string, unknown> {
    return {
      document_id: entity.id,
      owner_user_id: entity.ownerUserId,
      document_type: entity.documentType,
      document_number_masked: `****${entity.documentNumberLast4}`,
      country: entity.country,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString(),
      version: entity.version
    };
  }
}
