import { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkflowAnalyticsSyncEnhancements1700000006000 implements MigrationInterface {
  name = 'WorkflowAnalyticsSyncEnhancements1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS subject_type varchar(80)');
    await queryRunner.query('ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS subject_id uuid');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_analytics_events_type_subject_occurred ON analytics_events (event_type, subject_type, occurred_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_exports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        requested_by uuid NOT NULL,
        report_type varchar(80) NOT NULL,
        filters jsonb NOT NULL DEFAULT '{}'::jsonb,
        columns jsonb NOT NULL DEFAULT '[]'::jsonb,
        status varchar(20) NOT NULL DEFAULT 'READY',
        file_path varchar(255),
        file_size_bytes integer,
        expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_analytics_exports_requested_by_created_at ON analytics_exports (requested_by, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(150) NOT NULL,
        approval_mode varchar(20) NOT NULL,
        sla_hours integer NOT NULL DEFAULT 48,
        active boolean NOT NULL DEFAULT true,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_workflow_definitions_active_created_at ON workflow_definitions (active, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_steps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_definition_id uuid NOT NULL,
        "order" integer NOT NULL,
        approver_role varchar(64) NOT NULL,
        conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_workflow_steps_definition FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_workflow_steps_definition_order ON workflow_steps (workflow_definition_id, "order")');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_definition_id uuid NOT NULL,
        resource_type varchar(80) NOT NULL,
        resource_ref varchar(150) NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        status varchar(20) NOT NULL DEFAULT 'PENDING',
        current_step_order integer NOT NULL DEFAULT 1,
        requested_by uuid NOT NULL,
        deadline_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_workflow_requests_definition FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_workflow_requests_status_deadline ON workflow_requests (status, deadline_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_approvals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_request_id uuid NOT NULL,
        step_order integer NOT NULL,
        approver_user_id uuid NOT NULL,
        action varchar(20) NOT NULL,
        comment varchar(512),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_workflow_approvals_request FOREIGN KEY (workflow_request_id) REFERENCES workflow_requests(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_workflow_approvals_request_step ON workflow_approvals (workflow_request_id, step_order)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_workflow_approvals_request_step');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_approvals');
    await queryRunner.query('DROP INDEX IF EXISTS idx_workflow_requests_status_deadline');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_requests');
    await queryRunner.query('DROP INDEX IF EXISTS idx_workflow_steps_definition_order');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_steps');
    await queryRunner.query('DROP INDEX IF EXISTS idx_workflow_definitions_active_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_definitions');

    await queryRunner.query('DROP INDEX IF EXISTS idx_analytics_exports_requested_by_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS analytics_exports');

    await queryRunner.query('DROP INDEX IF EXISTS idx_analytics_events_type_subject_occurred');
    await queryRunner.query('ALTER TABLE analytics_events DROP COLUMN IF EXISTS subject_id');
    await queryRunner.query('ALTER TABLE analytics_events DROP COLUMN IF EXISTS subject_type');
  }
}
