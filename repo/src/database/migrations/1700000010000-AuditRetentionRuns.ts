import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditRetentionRuns1700000010000 implements MigrationInterface {
  name = 'AuditRetentionRuns1700000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_retention_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        retention_years integer NOT NULL,
        threshold_at timestamptz NOT NULL,
        candidate_count integer NOT NULL,
        strategy varchar(50) NOT NULL,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_audit_retention_runs_created_at ON audit_retention_runs (created_at)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_audit_retention_runs_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS audit_retention_runs');
  }
}
