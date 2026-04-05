import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepository: Repository<AuditLogEntity>,
    private readonly dataSource: DataSource
  ) {}

  async appendLog(input: {
    entityType: string;
    entityId?: string | null;
    action: string;
    actorId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<AuditLogEntity> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Serialize chain-head updates across concurrent writers in the same DB.
      await queryRunner.query(`SELECT pg_advisory_xact_lock(hashtext('audit_log_chain'))`);

      const previous = await queryRunner.manager
        .createQueryBuilder(AuditLogEntity, 'audit')
        .orderBy('audit.created_at', 'DESC')
        .addOrderBy('audit.id', 'DESC')
        .limit(1)
        .useTransaction(true)
        .getOne();

      const payload = input.payload ?? {};
      const createdAt = new Date().toISOString();
      const hashInput = this.buildHashInput({
        previous_hash: previous?.entryHash ?? null,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        action: input.action,
        actor_id: input.actorId ?? null,
        payload,
        created_at: createdAt
      });

      const entryHash = createHash('sha256').update(hashInput).digest('hex');

      const entity = this.auditRepository.create({
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        action: input.action,
        actorId: input.actorId ?? null,
        previousHash: previous?.entryHash ?? null,
        entryHash,
        hashInput,
        payload
      });

      const saved = await queryRunner.manager.save(entity);
      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async verifyIntegrity(input?: {
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<{
    valid: boolean;
    first_invalid_record_id: string | null;
    checked_count: number;
    from: string | null;
    to: string | null;
  }> {
    const qb = this.auditRepository.createQueryBuilder('audit').where('audit.deleted_at IS NULL');
    if (input?.from) {
      qb.andWhere('audit.created_at >= :from', { from: input.from });
    }
    if (input?.to) {
      qb.andWhere('audit.created_at <= :to', { to: input.to });
    }

    qb.orderBy('audit.created_at', 'ASC').addOrderBy('audit.id', 'ASC');
    qb.take(input?.limit && input.limit > 0 ? input.limit : 5000);
    const rows = await qb.getMany();

    let checkedCount = 0;
    let previousEntryHash: string | null = null;

    // When a bounded window is used, the first in-range row's previous_hash
    // may reference a record outside the window. Seed the chain from the
    // predecessor so a valid chain is not falsely flagged as broken.
    const hasFilters = !!(input?.from || input?.to);
    if (hasFilters && rows.length > 0) {
      const firstRow = rows[0]!;
      if (firstRow.previousHash !== null) {
        const predecessorQb = this.auditRepository
          .createQueryBuilder('audit')
          .where('audit.deleted_at IS NULL')
          .andWhere('audit.entry_hash = :hash', { hash: firstRow.previousHash })
          .limit(1);
        const predecessor = await predecessorQb.getOne();
        if (predecessor) {
          previousEntryHash = predecessor.entryHash;
        }
      }
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      checkedCount += 1;

      if ((row.previousHash ?? null) !== previousEntryHash) {
        return {
          valid: false,
          first_invalid_record_id: row.id,
          checked_count: checkedCount,
          from: rows[0]?.createdAt.toISOString() ?? null,
          to: rows[rows.length - 1]?.createdAt.toISOString() ?? null
        };
      }

      if (row.hashInput) {
        const recomputed = createHash('sha256').update(row.hashInput).digest('hex');
        if (recomputed !== row.entryHash) {
          return {
            valid: false,
            first_invalid_record_id: row.id,
            checked_count: checkedCount,
            from: rows[0]?.createdAt.toISOString() ?? null,
            to: rows[rows.length - 1]?.createdAt.toISOString() ?? null
          };
        }
      }

      previousEntryHash = row.entryHash;
    }

    return {
      valid: true,
      first_invalid_record_id: null,
      checked_count: checkedCount,
      from: rows[0]?.createdAt.toISOString() ?? input?.from ?? null,
      to: rows[rows.length - 1]?.createdAt.toISOString() ?? input?.to ?? null
    };
  }

  async getLogs(query: AuditLogQueryDto): Promise<{
    items: AuditLogEntity[];
    page: number;
    page_size: number;
    total: number;
  }> {
    const qb = this.auditRepository.createQueryBuilder('audit').where('audit.deleted_at IS NULL');

    if (query.actor_id) {
      qb.andWhere('audit.actor_id = :actorId', { actorId: query.actor_id });
    }

    if (query.entity_type) {
      qb.andWhere('audit.entity_type = :entityType', { entityType: query.entity_type });
    }

    if (query.from) {
      qb.andWhere('audit.created_at >= :from', { from: query.from });
    }

    if (query.to) {
      qb.andWhere('audit.created_at <= :to', { to: query.to });
    }

    const page = query.page;
    const pageSize = query.page_size;
    qb.orderBy('audit.created_at', 'DESC').addOrderBy('audit.id', 'DESC').skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      page,
      page_size: pageSize,
      total
    };
  }

  private buildHashInput(input: {
    previous_hash: string | null;
    entity_type: string;
    entity_id: string | null;
    action: string;
    actor_id: string | null;
    payload: Record<string, unknown>;
    created_at: string;
  }): string {
    return this.stableStringify(input);
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.sortDeep(value));
  }

  private sortDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortDeep(item));
    }

    if (value && typeof value === 'object') {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
      for (const key of keys) {
        sorted[key] = this.sortDeep((value as Record<string, unknown>)[key]);
      }
      return sorted;
    }

    return value;
  }
}
