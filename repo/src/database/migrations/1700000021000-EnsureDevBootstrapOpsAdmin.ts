import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ensures a local bootstrap ops_admin exists when the earlier SeedDevOpsAdmin migration
 * ran as a no-op (missing env at first migrate). Safe to skip when the user already exists.
 *
 * Never runs meaningful work in production.
 */
const DEV_BOOTSTRAP_PASSWORD_HASH =
  '$2a$10$V8usYaFEDiOQ/K96AyrVc.Q/z.cABCkYfOv2vy67xiMB0nwoY2w9.';

export class EnsureDevBootstrapOpsAdmin1700000021000 implements MigrationInterface {
  name = 'EnsureDevBootstrapOpsAdmin1700000021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase();
    if (nodeEnv === 'production') {
      return;
    }

    const username = process.env.BOOTSTRAP_OPS_USERNAME || 'dev_ops_admin';
    const passwordHash =
      process.env.BOOTSTRAP_OPS_PASSWORD_HASH || DEV_BOOTSTRAP_PASSWORD_HASH;

    if (process.env.BOOTSTRAP_OPS_PASSWORD_HASH) {
      if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(passwordHash)) {
        throw new Error(
          'BOOTSTRAP_OPS_PASSWORD_HASH must be a valid bcrypt hash (cost ≥ 10).',
        );
      }
    }

    const existing: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM users WHERE username = $1 LIMIT 1`,
      [username],
    );
    if (existing.length > 0) {
      return;
    }

    await queryRunner.query(
      `INSERT INTO users (username, password_hash, status) VALUES ($1, $2, 'ACTIVE')`,
      [username, passwordHash],
    );

    await queryRunner.query(
      `
      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.id
      FROM users u
      JOIN roles r ON r.name = 'ops_admin' AND r.deleted_at IS NULL
      WHERE u.username = $1
      ON CONFLICT (user_id, role_id) DO NOTHING;
    `,
      [username],
    );
  }

  public async down(): Promise<void> {
    // Non-destructive repair migration — no down.
  }
}
