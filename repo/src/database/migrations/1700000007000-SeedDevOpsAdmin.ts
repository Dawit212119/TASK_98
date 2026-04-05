import { MigrationInterface, QueryRunner } from 'typeorm';
import { createHash } from 'node:crypto';

/**
 * Bootstrap ops-admin user from environment variables.
 *
 * Required env vars:
 *   BOOTSTRAP_OPS_USERNAME – admin username
 *   BOOTSTRAP_OPS_PASSWORD_HASH – bcrypt hash of the admin password
 *
 * Optional:
 *   BOOTSTRAP_OPS_SECURITY_ANSWER_HASH – bcrypt hash for security answer
 *   NODE_ENV – when 'production', the migration refuses to run without the env vars
 *
 * The migration is a no-op when env vars are absent and NODE_ENV is not 'production',
 * allowing developers to bootstrap manually or via a CLI init flow.
 */
export class SeedDevOpsAdmin1700000007000 implements MigrationInterface {
  name = 'SeedDevOpsAdmin1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const username = process.env.BOOTSTRAP_OPS_USERNAME;
    const passwordHash = process.env.BOOTSTRAP_OPS_PASSWORD_HASH;
    const securityAnswerHash = process.env.BOOTSTRAP_OPS_SECURITY_ANSWER_HASH;
    const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase();

    if (!username || !passwordHash) {
      if (nodeEnv === 'production') {
        throw new Error(
          'BOOTSTRAP_OPS_USERNAME and BOOTSTRAP_OPS_PASSWORD_HASH must be set in production. ' +
          'Generate a bcrypt hash of the desired password and provide it as BOOTSTRAP_OPS_PASSWORD_HASH.'
        );
      }
      // Non-production without env vars: skip seeding silently.
      // The admin user can be created later via CLI or manual SQL.
      return;
    }

    // Guard against obviously weak usernames in production
    if (nodeEnv === 'production') {
      const weakUsernames = new Set(['dev_ops_admin', 'admin', 'root', 'test']);
      if (weakUsernames.has(username.toLowerCase())) {
        throw new Error(
          `BOOTSTRAP_OPS_USERNAME '${username}' is not allowed in production. Use a non-default username.`
        );
      }
    }

    // Validate that password hash looks like bcrypt (starts with $2a$ or $2b$)
    if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(passwordHash)) {
      throw new Error(
        'BOOTSTRAP_OPS_PASSWORD_HASH must be a valid bcrypt hash. ' +
        'Do not pass plaintext passwords — pre-hash with bcrypt (cost ≥ 10).'
      );
    }

    await queryRunner.query(`
      INSERT INTO users (username, password_hash, status)
      VALUES ($1, $2, 'ACTIVE')
      ON CONFLICT (username) DO NOTHING;
    `, [username, passwordHash]);

    if (securityAnswerHash) {
      await queryRunner.query(`
        INSERT INTO security_answers (user_id, question_id, answer_hash)
        SELECT u.id,
               (SELECT id FROM security_questions WHERE active = true AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1),
               $1
        FROM users u
        WHERE u.username = $2
          AND NOT EXISTS (
            SELECT 1 FROM security_answers sa WHERE sa.user_id = u.id
          );
      `, [securityAnswerHash, username]);
    }

    await queryRunner.query(`
      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.id
      FROM users u
      JOIN roles r ON r.name = 'ops_admin' AND r.deleted_at IS NULL
      WHERE u.username = $1
      ON CONFLICT (user_id, role_id) DO NOTHING;
    `, [username]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const username = process.env.BOOTSTRAP_OPS_USERNAME;
    if (!username) {
      return;
    }
    await queryRunner.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username = $1)`, [username]);
    await queryRunner.query(`DELETE FROM security_answers WHERE user_id IN (SELECT id FROM users WHERE username = $1)`, [username]);
    await queryRunner.query(`DELETE FROM users WHERE username = $1`, [username]);
  }
}
