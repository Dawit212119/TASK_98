import { MigrationInterface, QueryRunner } from 'typeorm';

export class DataScopePolicy1700000008000 implements MigrationInterface {
  name = 'DataScopePolicy1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_scopes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_type varchar(32) NOT NULL,
        scope_key varchar(128) NOT NULL UNIQUE,
        description varchar(255),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_data_scopes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        scope_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT uq_user_data_scopes_user_scope UNIQUE (user_id, scope_id),
        CONSTRAINT fk_user_data_scopes_user FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT fk_user_data_scopes_scope FOREIGN KEY (scope_id) REFERENCES data_scopes(id)
      )
    `);

    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_user_data_scopes_user_id ON user_data_scopes (user_id)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_user_data_scopes_scope_id ON user_data_scopes (scope_id)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reservation_data_scopes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id uuid NOT NULL,
        scope_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT uq_reservation_data_scopes_reservation_scope UNIQUE (reservation_id, scope_id),
        CONSTRAINT fk_reservation_data_scopes_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
        CONSTRAINT fk_reservation_data_scopes_scope FOREIGN KEY (scope_id) REFERENCES data_scopes(id)
      )
    `);

    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_reservation_data_scopes_reservation_id ON reservation_data_scopes (reservation_id)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_reservation_data_scopes_scope_id ON reservation_data_scopes (scope_id)');

    await queryRunner.query(`
      INSERT INTO data_scopes (scope_type, scope_key, description)
      VALUES ('clinic', 'default_clinic', 'Default clinic scope for development and bootstrap')
      ON CONFLICT (scope_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO user_data_scopes (user_id, scope_id)
      SELECT ur.user_id, ds.id
      FROM user_roles ur
      INNER JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
      CROSS JOIN data_scopes ds
      WHERE ds.scope_key = 'default_clinic'
        AND ur.deleted_at IS NULL
        AND r.name IN ('ops_admin', 'staff', 'provider')
      ON CONFLICT (user_id, scope_id) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO reservation_data_scopes (reservation_id, scope_id)
      SELECT r.id, ds.id
      FROM reservations r
      CROSS JOIN data_scopes ds
      WHERE ds.scope_key = 'default_clinic'
        AND r.deleted_at IS NULL
      ON CONFLICT (reservation_id, scope_id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_reservation_data_scopes_scope_id');
    await queryRunner.query('DROP INDEX IF EXISTS idx_reservation_data_scopes_reservation_id');
    await queryRunner.query('DROP TABLE IF EXISTS reservation_data_scopes');
    await queryRunner.query('DROP INDEX IF EXISTS idx_user_data_scopes_scope_id');
    await queryRunner.query('DROP INDEX IF EXISTS idx_user_data_scopes_user_id');
    await queryRunner.query('DROP TABLE IF EXISTS user_data_scopes');
    await queryRunner.query("DELETE FROM data_scopes WHERE scope_key = 'default_clinic'");
    await queryRunner.query('DROP TABLE IF EXISTS data_scopes');
  }
}
