import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('data_scopes')
export class DataScopeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 32 })
  scopeType!: string;

  @Column({ name: 'scope_key', type: 'varchar', length: 128, unique: true })
  scopeKey!: string;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
