import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('workflow_steps')
export class WorkflowStepEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_definition_id', type: 'uuid' })
  workflowDefinitionId!: string;

  @Column({ type: 'integer' })
  order!: number;

  @Column({ name: 'approver_role', type: 'varchar', length: 64 })
  approverRole!: string;

  @Column({ type: 'jsonb', default: {} })
  conditions!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
