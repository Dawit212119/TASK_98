import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ensures audit_logs.hash_input exists. Older DBs may have recorded
 * BackfillReservationDefaultScope1700000012000 before that migration added this column,
 * leaving the schema out of sync with AuditLogEntity.
 */
export class EnsureAuditLogsHashInput1700000013000 implements MigrationInterface {
  name = 'EnsureAuditLogsHashInput1700000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS hash_input text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS hash_input`);
  }
}
