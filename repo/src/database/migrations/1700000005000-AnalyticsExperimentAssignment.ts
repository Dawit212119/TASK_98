import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnalyticsExperimentAssignment1700000005000 implements MigrationInterface {
  name = 'AnalyticsExperimentAssignment1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_experiments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(150) NOT NULL,
        variants jsonb NOT NULL DEFAULT '[]'::jsonb,
        start_at timestamptz,
        end_at timestamptz,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_analytics_experiments_active_created_at ON analytics_experiments (active, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_experiment_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        experiment_id uuid NOT NULL,
        user_id uuid NOT NULL,
        variant varchar(60) NOT NULL,
        algorithm varchar(80) NOT NULL DEFAULT 'hash(user_id)%N',
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_analytics_assignments_experiment FOREIGN KEY (experiment_id) REFERENCES analytics_experiments(id),
        CONSTRAINT uq_analytics_experiment_user UNIQUE (experiment_id, user_id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_analytics_assignments_user_experiment ON analytics_experiment_assignments (user_id, experiment_id)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_analytics_assignments_user_experiment');
    await queryRunner.query('DROP TABLE IF EXISTS analytics_experiment_assignments');
    await queryRunner.query('DROP INDEX IF EXISTS idx_analytics_experiments_active_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS analytics_experiments');
  }
}
