import { MigrationInterface, QueryRunner } from 'typeorm';

export class DataScopeAdminPermissions1700000017000 implements MigrationInterface {
  name = 'DataScopeAdminPermissions1700000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO permissions (code, description)
      VALUES
        ('access.scopes.read',  'List all data scopes and read user data-scope assignments'),
        ('access.scopes.write', 'Assign or replace user data-scope assignments')
      ON CONFLICT (code) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      INNER JOIN permissions p ON p.code IN ('access.scopes.read', 'access.scopes.write') AND p.deleted_at IS NULL
      WHERE r.name = 'ops_admin' AND r.deleted_at IS NULL
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE permission_id IN (
        SELECT id FROM permissions WHERE code IN ('access.scopes.read', 'access.scopes.write')
      );
    `);
    await queryRunner.query(`
      DELETE FROM permissions WHERE code IN ('access.scopes.read', 'access.scopes.write');
    `);
  }
}
