import { MigrationInterface, QueryRunner } from 'typeorm';

export class FkConstraintsRolesPermissions1700000016000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_roles_user'
        ) THEN
          ALTER TABLE user_roles
            ADD CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
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
          ALTER TABLE user_roles
            ADD CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
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
          ALTER TABLE role_permissions
            ADD CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
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
          ALTER TABLE role_permissions
            ADD CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE role_permissions
        DROP CONSTRAINT IF EXISTS fk_role_permissions_permission,
        DROP CONSTRAINT IF EXISTS fk_role_permissions_role;
    `);
    await queryRunner.query(`
      ALTER TABLE user_roles
        DROP CONSTRAINT IF EXISTS fk_user_roles_role,
        DROP CONSTRAINT IF EXISTS fk_user_roles_user;
    `);
  }
}
