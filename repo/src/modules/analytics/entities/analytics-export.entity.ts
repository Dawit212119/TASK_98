import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('analytics_exports')
export class AnalyticsExportEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'requested_by', type: 'uuid' })
  requestedBy!: string;

  @Column({ name: 'report_type', type: 'varchar', length: 80 })
  reportType!: string;

  @Column({ type: 'jsonb', default: {} })
  filters!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: [] })
  columns!: string[];

  @Column({ type: 'varchar', length: 20, default: 'READY' })
  status!: string;

  @Column({ name: 'file_path', type: 'varchar', length: 255, nullable: true })
  filePath!: string | null;

  @Column({ name: 'file_size_bytes', type: 'integer', nullable: true })
  fileSizeBytes!: number | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
