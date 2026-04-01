import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('analytics_experiment_assignments')
@Unique('uq_analytics_experiment_user', ['experimentId', 'userId'])
export class AnalyticsAssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'experiment_id', type: 'uuid' })
  experimentId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 60 })
  variant!: string;

  @Column({ type: 'varchar', length: 80, default: 'hash(user_id)%N' })
  algorithm!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
