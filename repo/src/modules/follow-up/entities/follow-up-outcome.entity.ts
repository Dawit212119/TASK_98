import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('follow_up_outcomes')
export class FollowUpOutcomeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  @Column({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy!: string | null;

  @Column({ type: 'varchar', length: 20 })
  status!: 'DONE' | 'MISSED' | 'DEFERRED';

  @Column({ name: 'outcome_payload', type: 'jsonb', default: {} })
  outcomePayload!: Record<string, unknown>;

  @Column({ name: 'adherence_score', type: 'numeric', precision: 5, scale: 2 })
  adherenceScore!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
