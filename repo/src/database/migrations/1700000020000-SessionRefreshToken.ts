import { MigrationInterface, QueryRunner } from 'typeorm';

export class SessionRefreshToken1700000020000 implements MigrationInterface {
  name = 'SessionRefreshToken1700000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS refresh_token_hash varchar(64)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash
      ON sessions (refresh_token_hash)
      WHERE refresh_token_hash IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sessions_refresh_token_hash`);
    await queryRunner.query(`ALTER TABLE sessions DROP COLUMN IF EXISTS refresh_token_hash`);
  }
}
