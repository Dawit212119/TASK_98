import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('reservation_state_transitions')
export class ReservationStateTransitionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'reservation_id', type: 'uuid' })
  reservationId!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 32 })
  fromStatus!: string;

  @Column({ name: 'to_status', type: 'varchar', length: 32 })
  toStatus!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
