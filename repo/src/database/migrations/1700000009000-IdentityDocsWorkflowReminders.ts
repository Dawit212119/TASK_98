import { MigrationInterface, QueryRunner } from 'typeorm';

export class IdentityDocsWorkflowReminders1700000009000 implements MigrationInterface {
  name = 'IdentityDocsWorkflowReminders1700000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS identity_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id uuid NOT NULL,
        document_type varchar(50) NOT NULL,
        encrypted_document_number text NOT NULL,
        encryption_iv varchar(64) NOT NULL,
        encryption_auth_tag varchar(64) NOT NULL,
        document_number_last4 varchar(4) NOT NULL,
        country varchar(2),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_identity_documents_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
      )
    `);

    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_identity_documents_owner_user_id ON identity_documents (owner_user_id)');

    await queryRunner.query(`
      ALTER TABLE workflow_requests
      ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE workflow_requests DROP COLUMN IF EXISTS last_reminder_at');
    await queryRunner.query('DROP INDEX IF EXISTS idx_identity_documents_owner_user_id');
    await queryRunner.query('DROP TABLE IF EXISTS identity_documents');
  }
}
