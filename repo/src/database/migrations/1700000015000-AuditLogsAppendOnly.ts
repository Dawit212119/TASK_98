import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditLogsAppendOnly1700000015000 implements MigrationInterface {
  name = 'AuditLogsAppendOnly1700000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs`);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_logs_no_update
      BEFORE UPDATE ON audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION prevent_audit_log_mutation();
    `);

    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs`);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_logs_no_delete
      BEFORE DELETE ON audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION prevent_audit_log_mutation();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_audit_log_mutation`);
  }
}
