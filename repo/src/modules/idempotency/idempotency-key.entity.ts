import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Unique constraints are enforced via partial DB indexes (see migration
 * 1700000018000-IdempotencyActorBinding):
 *   - authenticated: UNIQUE(key, endpoint, actor_user_id) WHERE actor_user_id IS NOT NULL
 *   - anonymous:     UNIQUE(key, endpoint)               WHERE actor_user_id IS NULL
 */
@Entity('idempotency_keys')
export class IdempotencyKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ type: 'varchar', length: 255 })
  endpoint!: string;

  /** Null for unauthenticated (public) endpoints; set to the JWT subject for authenticated routes. */
  @Column({ name: 'actor_user_id', type: 'varchar', length: 36, nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'request_hash', type: 'varchar', length: 128, nullable: true })
  requestHash!: string | null;

  @Column({ name: 'response_status', type: 'integer', nullable: true })
  responseStatus!: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody!: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
