import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyKeyEntity } from './idempotency-key.entity';

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKeyEntity)
    private readonly idempotencyRepository: Repository<IdempotencyKeyEntity>
  ) {}

  findByKeyAndEndpoint(key: string, endpoint: string): Promise<IdempotencyKeyEntity | null> {
    return this.idempotencyRepository.findOne({ where: { key, endpoint } });
  }

  async saveResult(input: {
    key: string;
    endpoint: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  }): Promise<void> {
    const entity = this.idempotencyRepository.create({
      key: input.key,
      endpoint: input.endpoint,
      requestHash: input.requestHash,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody
    });

    await this.idempotencyRepository.save(entity);
  }
}
