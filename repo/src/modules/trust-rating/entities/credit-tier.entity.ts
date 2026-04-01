import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('credit_tiers')
export class CreditTierEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  tier!: string;

  @Column({ name: 'factors_snapshot', type: 'jsonb', default: {} })
  factorsSnapshot!: Record<string, unknown>;

  @Column({ name: 'effective_at', type: 'timestamptz' })
  effectiveAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
