import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('review_appeals')
export class ReviewAppealEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId!: string;

  @Column({ name: 'appellant_user_id', type: 'uuid' })
  appellantUserId!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'evidence_files', type: 'jsonb', default: [] })
  evidenceFiles!: string[];

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
