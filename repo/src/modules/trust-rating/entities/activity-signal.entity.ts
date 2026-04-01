import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('activity_signals')
export class ActivitySignalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'action_type', type: 'varchar', length: 60 })
  actionType!: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 80, nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'device_id', type: 'varchar', length: 120, nullable: true })
  deviceId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
