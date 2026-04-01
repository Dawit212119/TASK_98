import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum WorkflowApprovalMode {
  ALL_REQUIRED = 'ALL_REQUIRED',
  ANY_ONE = 'ANY_ONE'
}

@Entity('workflow_definitions')
export class WorkflowDefinitionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'approval_mode', type: 'varchar', length: 20 })
  approvalMode!: WorkflowApprovalMode;

  @Column({ name: 'sla_hours', type: 'integer', default: 48 })
  slaHours!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
