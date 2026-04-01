import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('reviews')
export class ReviewEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'reservation_id', type: 'uuid' })
  reservationId!: string;

  @Column({ name: 'reviewer_user_id', type: 'uuid' })
  reviewerUserId!: string;

  @Column({ name: 'target_user_id', type: 'uuid' })
  targetUserId!: string;

  @Column({ type: 'jsonb', default: [] })
  dimensions!: Array<{ name: string; score: number }>;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
