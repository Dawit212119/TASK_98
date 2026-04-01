import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('workflow_approvals')
export class WorkflowApprovalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_request_id', type: 'uuid' })
  workflowRequestId!: string;

  @Column({ name: 'step_order', type: 'integer' })
  stepOrder!: number;

  @Column({ name: 'approver_user_id', type: 'uuid' })
  approverUserId!: string;

  @Column({ type: 'varchar', length: 20 })
  action!: 'APPROVE' | 'REJECT';

  @Column({ type: 'varchar', length: 512, nullable: true })
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
