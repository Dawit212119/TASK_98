import { MigrationInterface, QueryRunner } from 'typeorm';

export class FollowUpDomain1700000003000 implements MigrationInterface {
  name = 'FollowUpDomain1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS follow_up_tags (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id uuid NOT NULL,
        key varchar(100) NOT NULL,
        value varchar(120) NOT NULL,
        source varchar(100) NOT NULL,
        ingested_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_follow_up_tags_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_follow_up_tags_reservation_key_created_at ON follow_up_tags (reservation_id, key, created_at)'
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS follow_up_plan_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(150) NOT NULL,
        trigger_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        task_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
        active boolean NOT NULL DEFAULT true,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_follow_up_plan_templates_active_created_at ON follow_up_plan_templates (active, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS follow_up_plans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id uuid NOT NULL,
        reservation_id uuid,
        template_id uuid NOT NULL,
        start_date date NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_follow_up_plans_template FOREIGN KEY (template_id) REFERENCES follow_up_plan_templates(id),
        CONSTRAINT fk_follow_up_plans_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_follow_up_plans_patient_status_start_date ON follow_up_plans (patient_id, status, start_date)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_follow_up_plans_reservation ON follow_up_plans (reservation_id)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS follow_up_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id uuid NOT NULL,
        task_name varchar(150) NOT NULL,
        rule_type varchar(20) NOT NULL,
        rule_value integer NOT NULL,
        sequence_no integer NOT NULL DEFAULT 1,
        due_at timestamptz NOT NULL,
        next_due_at timestamptz,
        status varchar(20) NOT NULL DEFAULT 'PENDING',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_follow_up_tasks_plan FOREIGN KEY (plan_id) REFERENCES follow_up_plans(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_plan_due_status ON follow_up_tasks (plan_id, due_at, status)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS follow_up_outcomes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id uuid NOT NULL,
        recorded_by uuid,
        status varchar(20) NOT NULL,
        outcome_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        adherence_score numeric(5,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_follow_up_outcomes_task FOREIGN KEY (task_id) REFERENCES follow_up_tasks(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_follow_up_outcomes_task_created_at ON follow_up_outcomes (task_id, created_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_follow_up_outcomes_status_created_at ON follow_up_outcomes (status, created_at)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_follow_up_outcomes_status_created_at');
    await queryRunner.query('DROP INDEX IF EXISTS idx_follow_up_outcomes_task_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS follow_up_outcomes');

    await queryRunner.query('DROP INDEX IF EXISTS idx_follow_up_tasks_plan_due_status');
    await queryRunner.query('DROP TABLE IF EXISTS follow_up_tasks');

    await queryRunner.query('DROP INDEX IF EXISTS idx_follow_up_plans_reservation');
    await queryRunner.query('DROP INDEX IF EXISTS idx_follow_up_plans_patient_status_start_date');
    await queryRunner.query('DROP TABLE IF EXISTS follow_up_plans');

    await queryRunner.query('DROP INDEX IF EXISTS idx_follow_up_plan_templates_active_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS follow_up_plan_templates');

    await queryRunner.query('DROP INDEX IF EXISTS idx_follow_up_tags_reservation_key_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS follow_up_tags');
  }
}
