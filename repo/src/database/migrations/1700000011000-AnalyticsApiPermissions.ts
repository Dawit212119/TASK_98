import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnalyticsApiPermissions1700000011000 implements MigrationInterface {
  name = 'AnalyticsApiPermissions1700000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO permissions (code, description)
      VALUES ('analytics.api.use', 'Analytics aggregations, experiments, assignments, and CSV exports')
      ON CONFLICT (code) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      INNER JOIN permissions p ON p.code = 'analytics.api.use' AND p.deleted_at IS NULL
      WHERE r.name IN ('ops_admin', 'analytics_viewer') AND r.deleted_at IS NULL
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'analytics.api.use')
    `);
    await queryRunner.query(`DELETE FROM permissions WHERE code = 'analytics.api.use'`);
  }
}
