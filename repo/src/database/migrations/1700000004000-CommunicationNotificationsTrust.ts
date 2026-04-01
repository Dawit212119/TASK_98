import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommunicationNotificationsTrust1700000004000 implements MigrationInterface {
  name = 'CommunicationNotificationsTrust1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS message_reads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id uuid NOT NULL,
        user_id uuid NOT NULL,
        last_read_message_id uuid,
        last_read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT uq_message_reads_reservation_user UNIQUE (reservation_id, user_id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_message_reads_reservation_user ON message_reads (reservation_id, user_id)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id uuid NOT NULL,
        owner_user_id uuid NOT NULL,
        category varchar(60) NOT NULL,
        description text NOT NULL,
        message_id uuid,
        status varchar(20) NOT NULL DEFAULT 'OPEN',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_support_tickets_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created_at ON support_tickets (status, created_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_support_tickets_reservation_created_at ON support_tickets (reservation_id, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        type varchar(50) NOT NULL,
        title varchar(150) NOT NULL,
        body text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created_at ON notifications (user_id, read_at, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sensitive_word_dictionary (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        word varchar(80) NOT NULL UNIQUE,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id uuid NOT NULL,
        reviewer_user_id uuid NOT NULL,
        target_user_id uuid NOT NULL,
        dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
        comment text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_reviews_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_reviews_reservation_created_at ON reviews (reservation_id, created_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_reviews_target_created_at ON reviews (target_user_id, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS review_appeals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        review_id uuid NOT NULL,
        appellant_user_id uuid NOT NULL,
        reason text NOT NULL,
        evidence_files jsonb NOT NULL DEFAULT '[]'::jsonb,
        status varchar(20) NOT NULL DEFAULT 'OPEN',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_review_appeals_review FOREIGN KEY (review_id) REFERENCES reviews(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_review_appeals_status_created_at ON review_appeals (status, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS appeal_decisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        appeal_id uuid NOT NULL,
        decided_by uuid NOT NULL,
        outcome varchar(20) NOT NULL,
        notes text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_appeal_decisions_appeal FOREIGN KEY (appeal_id) REFERENCES review_appeals(id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS credit_tiers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        tier varchar(20) NOT NULL,
        factors_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        effective_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_credit_tiers_user_effective_at ON credit_tiers (user_id, effective_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fraud_flags (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        reason varchar(120) NOT NULL,
        severity varchar(20) NOT NULL,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_fraud_flags_user_created_at ON fraud_flags (user_id, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS activity_signals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        action_type varchar(60) NOT NULL,
        ip_address varchar(80),
        device_id varchar(120),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_activity_signals_ip_created_at ON activity_signals (ip_address, created_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_activity_signals_device_created_at ON activity_signals (device_id, created_at)');

    await queryRunner.query(`
      INSERT INTO sensitive_word_dictionary (word, active)
      VALUES ('abuse', true), ('hate', true)
      ON CONFLICT (word) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM sensitive_word_dictionary WHERE word IN ('abuse','hate')`);

    await queryRunner.query('DROP INDEX IF EXISTS idx_activity_signals_device_created_at');
    await queryRunner.query('DROP INDEX IF EXISTS idx_activity_signals_ip_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS activity_signals');

    await queryRunner.query('DROP INDEX IF EXISTS idx_fraud_flags_user_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS fraud_flags');

    await queryRunner.query('DROP INDEX IF EXISTS idx_credit_tiers_user_effective_at');
    await queryRunner.query('DROP TABLE IF EXISTS credit_tiers');

    await queryRunner.query('DROP TABLE IF EXISTS appeal_decisions');

    await queryRunner.query('DROP INDEX IF EXISTS idx_review_appeals_status_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS review_appeals');

    await queryRunner.query('DROP INDEX IF EXISTS idx_reviews_target_created_at');
    await queryRunner.query('DROP INDEX IF EXISTS idx_reviews_reservation_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS reviews');

    await queryRunner.query('DROP TABLE IF EXISTS sensitive_word_dictionary');

    await queryRunner.query('DROP INDEX IF EXISTS idx_notifications_user_read_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS notifications');

    await queryRunner.query('DROP INDEX IF EXISTS idx_support_tickets_reservation_created_at');
    await queryRunner.query('DROP INDEX IF EXISTS idx_support_tickets_status_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS support_tickets');

    await queryRunner.query('DROP INDEX IF EXISTS idx_message_reads_reservation_user');
    await queryRunner.query('DROP TABLE IF EXISTS message_reads');
  }
}
