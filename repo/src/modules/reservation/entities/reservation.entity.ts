import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum ReservationStatus {
  CREATED = 'CREATED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED'
}

export enum RefundStatus {
  NONE = 'NONE',
  PARTIAL = 'PARTIAL',
  FULL = 'FULL'
}

@Entity('reservations')
export class ReservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'patient_id', type: 'uuid', nullable: true })
  patientId!: string | null;

  @Column({ name: 'provider_id', type: 'uuid', nullable: true })
  providerId!: string | null;

  @Column({ type: 'varchar', length: 32, default: ReservationStatus.CREATED })
  status!: ReservationStatus;

  @Column({ name: 'start_time', type: 'timestamptz', nullable: true })
  startTime!: Date | null;

  @Column({ name: 'end_time', type: 'timestamptz', nullable: true })
  endTime!: Date | null;

  @Column({ name: 'refund_percentage', type: 'integer', nullable: true })
  refundPercentage!: number | null;

  @Column({ name: 'refund_status', type: 'varchar', length: 16, nullable: true })
  refundStatus!: RefundStatus | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
