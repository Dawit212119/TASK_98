import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('follow_up_plan_templates')
export class FollowUpPlanTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'trigger_tags', type: 'jsonb', default: [] })
  triggerTags!: Array<{ key: string; value?: string }>;

  @Column({ name: 'task_rules', type: 'jsonb', default: [] })
  taskRules!: Array<{
    task_name: string;
    every_n_days?: number;
    every_n_months?: number;
    occurrences?: number;
  }>;

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
