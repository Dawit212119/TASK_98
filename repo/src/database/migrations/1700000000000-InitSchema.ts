import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id uuid,
        provider_id uuid,
        status varchar(32) NOT NULL DEFAULT 'CREATED',
        start_time timestamptz,
        end_time timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);

    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_reservations_status_start_time ON reservations (status, start_time)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_reservations_patient_start_time ON reservations (patient_id, start_time)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_reservations_provider_start_time ON reservations (provider_id, start_time)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        role_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        role_id uuid NOT NULL,
        permission_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions (role_id)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid,
        event_type varchar(64) NOT NULL,
        occurred_at timestamptz NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_analytics_events_type_occurred ON analytics_events (event_type, occurred_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_analytics_events_actor_occurred ON analytics_events (actor_id, occurred_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id uuid NOT NULL,
        sender_id uuid,
        content text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_messages_reservation_created_at ON messages (reservation_id, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar(64) NOT NULL,
        entity_id uuid,
        action varchar(128) NOT NULL,
        actor_id uuid,
        previous_hash varchar(128),
        entry_hash varchar(128) NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created_at ON audit_logs (entity_type, entity_id, created_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(255) NOT NULL,
        endpoint varchar(255) NOT NULL,
        request_hash varchar(128),
        response_status integer,
        response_body jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT uq_idempotency_key_endpoint UNIQUE (key, endpoint)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS idempotency_keys');
    await queryRunner.query('DROP INDEX IF EXISTS idx_audit_logs_created_at');
    await queryRunner.query('DROP INDEX IF EXISTS idx_audit_logs_entity_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS audit_logs');
    await queryRunner.query('DROP INDEX IF EXISTS idx_messages_reservation_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS messages');
    await queryRunner.query('DROP INDEX IF EXISTS idx_analytics_events_actor_occurred');
    await queryRunner.query('DROP INDEX IF EXISTS idx_analytics_events_type_occurred');
    await queryRunner.query('DROP TABLE IF EXISTS analytics_events');
    await queryRunner.query('DROP INDEX IF EXISTS idx_role_permissions_role_id');
    await queryRunner.query('DROP TABLE IF EXISTS role_permissions');
    await queryRunner.query('DROP INDEX IF EXISTS idx_user_roles_user_id');
    await queryRunner.query('DROP TABLE IF EXISTS user_roles');
    await queryRunner.query('DROP INDEX IF EXISTS idx_reservations_provider_start_time');
    await queryRunner.query('DROP INDEX IF EXISTS idx_reservations_patient_start_time');
    await queryRunner.query('DROP INDEX IF EXISTS idx_reservations_status_start_time');
    await queryRunner.query('DROP TABLE IF EXISTS reservations');
  }
}
