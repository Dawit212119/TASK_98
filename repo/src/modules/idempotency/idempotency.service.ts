import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { IdempotencyKeyEntity } from './idempotency-key.entity';

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKeyEntity)
    private readonly idempotencyRepository: Repository<IdempotencyKeyEntity>
  ) {}

  /**
   * Look up an existing idempotency record by (key, endpoint, actorUserId).
   * - Authenticated routes pass the JWT subject as actorUserId.
   * - Public (unauthenticated) routes pass null; the lookup is scoped to anonymous records only.
   */
  findByKeyEndpointAndActor(key: string, endpoint: string, actorUserId: string | null): Promise<IdempotencyKeyEntity | null> {
    if (actorUserId !== null) {
      return this.idempotencyRepository.findOne({ where: { key, endpoint, actorUserId } });
    }
    return this.idempotencyRepository.findOne({ where: { key, endpoint, actorUserId: IsNull() } });
  }

  async saveResult(input: {
    key: string;
    endpoint: string;
    actorUserId: string | null;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  }): Promise<void> {
    const entity = this.idempotencyRepository.create({
      key: input.key,
      endpoint: input.endpoint,
      actorUserId: input.actorUserId,
      requestHash: input.requestHash,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody
    });

    await this.idempotencyRepository.save(entity);
  }
}
