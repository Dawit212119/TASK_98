import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../audit/audit.service';
import { SensitiveWordEntity } from './entities/sensitive-word.entity';
import { AccessControlService } from '../access-control/access-control.service';

@Injectable()
export class SensitiveWordService {
  private cachedWords: Set<string> | null = null;
  private cacheExpiry: number = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly accessControlService: AccessControlService,
    private readonly auditService: AuditService,
    @InjectRepository(SensitiveWordEntity)
    private readonly sensitiveWordRepository: Repository<SensitiveWordEntity>
  ) {}

  async createSensitiveWord(userId: string, payload: { word: string }): Promise<Record<string, unknown>> {
    await this.requireOpsAdmin(userId);
    const normalized = payload.word.trim().toLowerCase();
    if (!normalized) {
      throw new AppException('VALIDATION_ERROR', 'word must not be empty', {}, 422);
    }

    const existing = await this.sensitiveWordRepository.findOne({ where: { word: normalized } });
    if (existing) {
      throw new AppException('SENSITIVE_WORD_EXISTS', 'Sensitive word already exists', {}, 409);
    }

    const entity = this.sensitiveWordRepository.create({ word: normalized, active: true });
    const saved = await this.sensitiveWordRepository.save(entity);

    await this.auditService.appendLog({
      entityType: 'sensitive_word',
      entityId: saved.id,
      action: 'sensitive_word.create',
      actorId: userId,
      payload: {
        word: saved.word,
        active: saved.active
      }
    });

    return this.mapSensitiveWord(saved);
  }

  async listSensitiveWords(userId: string, query: { active?: string }): Promise<Record<string, unknown>> {
    await this.requireOpsAdmin(userId);

    const qb = this.sensitiveWordRepository.createQueryBuilder('sw');
    if (query.active === 'true') {
      qb.andWhere('sw.active = true');
    }
    if (query.active === 'false') {
      qb.andWhere('sw.active = false');
    }

    qb.orderBy('sw.word', 'ASC').addOrderBy('sw.id', 'ASC');
    const items = await qb.getMany();

    await this.auditService.appendLog({
      entityType: 'sensitive_word',
      entityId: null,
      action: 'sensitive_word.list',
      actorId: userId,
      payload: {
        filter_active: query.active ?? null,
        result_count: items.length
      }
    });

    return {
      items: items.map((item) => this.mapSensitiveWord(item)),
      total: items.length
    };
  }

  async updateSensitiveWord(userId: string, wordId: string, payload: { word: string }): Promise<Record<string, unknown>> {
    await this.requireOpsAdmin(userId);

    const word = await this.sensitiveWordRepository.findOne({ where: { id: wordId } });
    if (!word) {
      throw new AppException('NOT_FOUND', 'Sensitive word not found', { word_id: wordId }, 404);
    }

    const normalized = payload.word.trim().toLowerCase();
    if (!normalized) {
      throw new AppException('VALIDATION_ERROR', 'word must not be empty', {}, 422);
    }

    const duplicate = await this.sensitiveWordRepository.findOne({ where: { word: normalized } });
    if (duplicate && duplicate.id !== wordId) {
      throw new AppException('SENSITIVE_WORD_EXISTS', 'Sensitive word already exists', {}, 409);
    }

    const before = word.word;
    word.word = normalized;
    const saved = await this.sensitiveWordRepository.save(word);

    await this.auditService.appendLog({
      entityType: 'sensitive_word',
      entityId: saved.id,
      action: 'sensitive_word.update',
      actorId: userId,
      payload: {
        before,
        after: saved.word,
        active: saved.active
      }
    });

    return this.mapSensitiveWord(saved);
  }

  async toggleSensitiveWord(userId: string, wordId: string, payload: { active: string }): Promise<Record<string, unknown>> {
    await this.requireOpsAdmin(userId);

    const word = await this.sensitiveWordRepository.findOne({ where: { id: wordId } });
    if (!word) {
      throw new AppException('NOT_FOUND', 'Sensitive word not found', { word_id: wordId }, 404);
    }

    const active = payload.active === 'true';
    const before = word.active;
    word.active = active;
    const saved = await this.sensitiveWordRepository.save(word);

    await this.auditService.appendLog({
      entityType: 'sensitive_word',
      entityId: saved.id,
      action: 'sensitive_word.toggle',
      actorId: userId,
      payload: {
        before_active: before,
        after_active: saved.active,
        word: saved.word
      }
    });

    return this.mapSensitiveWord(saved);
  }

  async enforceSensitiveWords(content: string): Promise<void> {
    let allWords: Set<string>;
    if (this.cachedWords !== null && Date.now() < this.cacheExpiry) {
      allWords = this.cachedWords;
    } else {
      const wordsFromDb = await this.sensitiveWordRepository.find({ where: { active: true } });
      const wordsFromEnv = (this.configService.get<string>('SENSITIVE_WORDS') ?? '')
        .split(',')
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean);

      allWords = new Set<string>([
        ...wordsFromDb.map((row) => row.word.toLowerCase()),
        ...wordsFromEnv
      ]);
      this.cachedWords = allWords;
      this.cacheExpiry = Date.now() + 60_000;
    }

    const normalizedContent = content.toLowerCase();
    const matched = [...allWords].find((word) => normalizedContent.includes(word));
    if (matched) {
      throw new AppException('SENSITIVE_WORD_VIOLATION', 'Message contains blocked content', {}, 422);
    }
  }

  private mapSensitiveWord(entity: SensitiveWordEntity): Record<string, unknown> {
    return {
      word_id: entity.id,
      word: entity.word,
      active: entity.active,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString()
    };
  }

  private async requireOpsAdmin(userId: string): Promise<void> {
    const roles = await this.accessControlService.getUserRoleNames(userId);
    if (!roles.includes('ops_admin')) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }
  }
}
