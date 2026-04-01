import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum FollowUpTaskStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  MISSED = 'MISSED',
  DEFERRED = 'DEFERRED'
}

@Entity('follow_up_tasks')
export class FollowUpTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'task_name', type: 'varchar', length: 150 })
  taskName!: string;

  @Column({ name: 'rule_type', type: 'varchar', length: 20 })
  ruleType!: 'days' | 'months';

  @Column({ name: 'rule_value', type: 'integer' })
  ruleValue!: number;

  @Column({ name: 'sequence_no', type: 'integer', default: 1 })
  sequenceNo!: number;

  @Column({ name: 'due_at', type: 'timestamptz' })
  dueAt!: Date;

  @Column({ name: 'next_due_at', type: 'timestamptz', nullable: true })
  nextDueAt!: Date | null;

  @Column({ type: 'varchar', length: 20, default: FollowUpTaskStatus.PENDING })
  status!: FollowUpTaskStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
