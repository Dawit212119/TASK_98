import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('identity_documents')
export class IdentityDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  @Column({ name: 'document_type', type: 'varchar', length: 50 })
  documentType!: string;

  @Column({ name: 'encrypted_document_number', type: 'text' })
  encryptedDocumentNumber!: string;

  @Column({ name: 'encryption_iv', type: 'varchar', length: 64 })
  encryptionIv!: string;

  @Column({ name: 'encryption_auth_tag', type: 'varchar', length: 64 })
  encryptionAuthTag!: string;

  @Column({ name: 'document_number_last4', type: 'varchar', length: 4 })
  documentNumberLast4!: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
