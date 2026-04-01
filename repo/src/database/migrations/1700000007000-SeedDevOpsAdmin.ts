import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedDevOpsAdmin1700000007000 implements MigrationInterface {
  name = 'SeedDevOpsAdmin1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO users (username, password_hash, status)
      VALUES ('dev_ops_admin', '$2a$10$hntfIF4MDMrgaCzZfKleMODLnEow1MpKkej5SpW46ojX6PxhLs/bS', 'ACTIVE')
      ON CONFLICT (username) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO security_answers (user_id, question_id, answer_hash)
      SELECT u.id,
             (SELECT id FROM security_questions WHERE active = true AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1),
             '$2a$10$2tbWe.jfQSGIRR.lNpCa/ehRTojrzza6.VuOt7fjxq85.z3Omexfi'
      FROM users u
      WHERE u.username = 'dev_ops_admin'
        AND NOT EXISTS (
          SELECT 1 FROM security_answers sa WHERE sa.user_id = u.id
        );
    `);

    await queryRunner.query(`
      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.id
      FROM users u
      JOIN roles r ON r.name = 'ops_admin' AND r.deleted_at IS NULL
      WHERE u.username = 'dev_ops_admin'
      ON CONFLICT (user_id, role_id) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username = 'dev_ops_admin')`);
    await queryRunner.query(`DELETE FROM security_answers WHERE user_id IN (SELECT id FROM users WHERE username = 'dev_ops_admin')`);
    await queryRunner.query(`DELETE FROM users WHERE username = 'dev_ops_admin'`);
  }
}
