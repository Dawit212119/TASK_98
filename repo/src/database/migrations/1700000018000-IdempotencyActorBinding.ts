import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds actor_user_id to idempotency_keys so that authenticated users cannot replay
 * each other's cached responses using the same Idempotency-Key + endpoint pair.
 *
 * Uniqueness is enforced through two partial indexes:
 *   - authenticated: (key, endpoint, actor_user_id) WHERE actor_user_id IS NOT NULL
 *   - anonymous:     (key, endpoint)               WHERE actor_user_id IS NULL
 *
 * The old table-level unique constraint is dropped before the indexes are created.
 */
export class IdempotencyActorBinding1700000018000 implements MigrationInterface {
  name = 'IdempotencyActorBinding1700000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add actor_user_id column (nullable — public endpoints have no actor).
    await queryRunner.query(`
      ALTER TABLE idempotency_keys
        ADD COLUMN IF NOT EXISTS actor_user_id varchar(36) NULL
    `);

    // 2. Remove the old (key, endpoint) table-level unique constraint.
    await queryRunner.query(`
      ALTER TABLE idempotency_keys
        DROP CONSTRAINT IF EXISTS uq_idempotency_key_endpoint
    `);

    // 3. Partial index for authenticated flows: one record per (key, endpoint, user).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_authed
        ON idempotency_keys (key, endpoint, actor_user_id)
        WHERE actor_user_id IS NOT NULL
    `);

    // 4. Partial index for anonymous (public) flows: one record per (key, endpoint).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_anon
        ON idempotency_keys (key, endpoint)
        WHERE actor_user_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_idempotency_authed`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_idempotency_anon`);
    await queryRunner.query(`
      ALTER TABLE idempotency_keys
        ADD CONSTRAINT uq_idempotency_key_endpoint UNIQUE (key, endpoint)
    `);
    await queryRunner.query(`
      ALTER TABLE idempotency_keys
        DROP COLUMN IF EXISTS actor_user_id
    `);
  }
}
