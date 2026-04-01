import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('reservation_files')
export class ReservationFileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'reservation_id', type: 'uuid' })
  reservationId!: string;

  @Column({ name: 'uploader_id', type: 'uuid', nullable: true })
  uploaderId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  filename!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 64 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes!: number;

  @Column({ name: 'storage_key', type: 'varchar', length: 255 })
  storageKey!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
