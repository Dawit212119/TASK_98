import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('appeal_decisions')
export class AppealDecisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'appeal_id', type: 'uuid' })
  appealId!: string;

  @Column({ name: 'decided_by', type: 'uuid' })
  decidedBy!: string;

  @Column({ type: 'varchar', length: 20 })
  outcome!: 'UPHOLD' | 'MODIFY' | 'REMOVE';

  @Column({ type: 'text' })
  notes!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
