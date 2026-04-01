import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum WorkflowRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED'
}

@Entity('workflow_requests')
export class WorkflowRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_definition_id', type: 'uuid' })
  workflowDefinitionId!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 80 })
  resourceType!: string;

  @Column({ name: 'resource_ref', type: 'varchar', length: 150 })
  resourceRef!: string;

  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: WorkflowRequestStatus.PENDING })
  status!: WorkflowRequestStatus;

  @Column({ name: 'current_step_order', type: 'integer', default: 1 })
  currentStepOrder!: number;

  @Column({ name: 'requested_by', type: 'uuid' })
  requestedBy!: string;

  @Column({ name: 'deadline_at', type: 'timestamptz' })
  deadlineAt!: Date;

  @Column({ name: 'last_reminder_at', type: 'timestamptz', nullable: true })
  lastReminderAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
