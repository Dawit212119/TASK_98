import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_retention_runs')
export class AuditRetentionRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'retention_years', type: 'integer' })
  retentionYears!: number;

  @Column({ name: 'threshold_at', type: 'timestamptz' })
  thresholdAt!: Date;

  @Column({ name: 'candidate_count', type: 'integer' })
  candidateCount!: number;

  @Column({ name: 'strategy', type: 'varchar', length: 50 })
  strategy!: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
