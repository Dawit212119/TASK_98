import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthAccessControlAudit1700000001000 implements MigrationInterface {
  name = 'AuthAccessControlAudit1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username varchar(100) NOT NULL UNIQUE,
        password_hash varchar(255) NOT NULL,
        failed_login_attempts integer NOT NULL DEFAULT 0,
        lockout_until timestamptz,
        status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(64) NOT NULL UNIQUE,
        description varchar(255),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(128) NOT NULL UNIQUE,
        description varchar(255),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        token_jti varchar(100) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        invalidated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS security_questions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        question varchar(255) NOT NULL UNIQUE,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS security_answers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL UNIQUE,
        question_id uuid NOT NULL,
        answer_hash varchar(255) NOT NULL,
        verify_failed_attempts integer NOT NULL DEFAULT 0,
        verify_locked_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_security_answers_user FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT fk_security_answers_question FOREIGN KEY (question_id) REFERENCES security_questions(id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        token_hash varchar(128) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens (user_id)');

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_roles_user_role'
        ) THEN
          ALTER TABLE user_roles ADD CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role_id);
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_roles_user'
        ) THEN
          ALTER TABLE user_roles ADD CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id);
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_roles_role'
        ) THEN
          ALTER TABLE user_roles ADD CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id);
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_role_permissions_role_permission'
        ) THEN
          ALTER TABLE role_permissions ADD CONSTRAINT uq_role_permissions_role_permission UNIQUE (role_id, permission_id);
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_role_permissions_role'
        ) THEN
          ALTER TABLE role_permissions ADD CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id);
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_role_permissions_permission'
        ) THEN
          ALTER TABLE role_permissions ADD CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id);
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      INSERT INTO security_questions (question)
      VALUES
        ('What city were you born in?'),
        ('What was your first school?'),
        ('What is your favorite childhood nickname?')
      ON CONFLICT (question) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO roles (name, description)
      VALUES
        ('patient', 'Patient role'),
        ('staff', 'Clinic staff role'),
        ('provider', 'Healthcare provider role'),
        ('merchant', 'Merchant/lab role'),
        ('ops_admin', 'Operations administrator role'),
        ('analytics_viewer', 'Analytics read role')
      ON CONFLICT (name) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO permissions (code, description)
      VALUES
        ('access.roles.read', 'Read role metadata'),
        ('access.roles.write', 'Create and edit roles'),
        ('access.user_roles.write', 'Assign roles to users'),
        ('access.audit.read', 'Read privileged audit logs')
      ON CONFLICT (code) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      CROSS JOIN permissions p
      WHERE r.name = 'ops_admin'
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name = 'ops_admin')`);
    await queryRunner.query(`DELETE FROM permissions WHERE code IN ('access.roles.read','access.roles.write','access.user_roles.write','access.audit.read')`);
    await queryRunner.query(`DELETE FROM roles WHERE name IN ('patient','staff','provider','merchant','ops_admin','analytics_viewer')`);
    await queryRunner.query(
      `DELETE FROM security_questions WHERE question IN ('What city were you born in?','What was your first school?','What is your favorite childhood nickname?')`
    );

    await queryRunner.query('DROP INDEX IF EXISTS idx_password_reset_tokens_user_id');
    await queryRunner.query('DROP TABLE IF EXISTS password_reset_tokens');
    await queryRunner.query('DROP TABLE IF EXISTS security_answers');
    await queryRunner.query('DROP TABLE IF EXISTS security_questions');
    await queryRunner.query('DROP INDEX IF EXISTS idx_sessions_user_id');
    await queryRunner.query('DROP TABLE IF EXISTS sessions');
    await queryRunner.query('DROP TABLE IF EXISTS permissions');
    await queryRunner.query('DROP TABLE IF EXISTS roles');
    await queryRunner.query('DROP TABLE IF EXISTS users');
  }
}
