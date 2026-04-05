import { MigrationInterface, QueryRunner } from 'typeorm';

export class DebugHealthPermission1700000019000 implements MigrationInterface {
  name = 'DebugHealthPermission1700000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO permissions (code, description)
      VALUES ('debug.health.view', 'Access /health/error-sample debug endpoint')
      ON CONFLICT (code) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      INNER JOIN permissions p ON p.code = 'debug.health.view' AND p.deleted_at IS NULL
      WHERE r.name = 'ops_admin' AND r.deleted_at IS NULL
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'debug.health.view');
    `);
    await queryRunner.query(`DELETE FROM permissions WHERE code = 'debug.health.view';`);
  }
}
