import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReservationAndFiles1700000002000 implements MigrationInterface {
  name = 'ReservationAndFiles1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE reservations ADD COLUMN IF NOT EXISTS refund_percentage integer');
    await queryRunner.query('ALTER TABLE reservations ADD COLUMN IF NOT EXISTS refund_status varchar(16)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reservation_state_transitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id uuid NOT NULL,
        from_status varchar(32) NOT NULL,
        to_status varchar(32) NOT NULL,
        action varchar(64) NOT NULL,
        actor_id uuid,
        reason varchar(255),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_reservation_transitions_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_reservation_state_transitions_reservation_created_at ON reservation_state_transitions (reservation_id, created_at)'
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reservation_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id uuid NOT NULL,
        author_id uuid,
        note text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_reservation_notes_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_reservation_notes_reservation_created_at ON reservation_notes (reservation_id, created_at)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reservation_files (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id uuid NOT NULL,
        uploader_id uuid,
        filename varchar(255) NOT NULL,
        mime_type varchar(64) NOT NULL,
        size_bytes integer NOT NULL,
        storage_key varchar(255) NOT NULL,
        label varchar(120),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        CONSTRAINT fk_reservation_files_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_reservation_files_reservation_created_at ON reservation_files (reservation_id, created_at)');
    await queryRunner.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_reservation_files_storage_key ON reservation_files (storage_key)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_reservation_files_storage_key');
    await queryRunner.query('DROP INDEX IF EXISTS idx_reservation_files_reservation_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS reservation_files');

    await queryRunner.query('DROP INDEX IF EXISTS idx_reservation_notes_reservation_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS reservation_notes');

    await queryRunner.query('DROP INDEX IF EXISTS idx_reservation_state_transitions_reservation_created_at');
    await queryRunner.query('DROP TABLE IF EXISTS reservation_state_transitions');

    await queryRunner.query('ALTER TABLE reservations DROP COLUMN IF EXISTS refund_status');
    await queryRunner.query('ALTER TABLE reservations DROP COLUMN IF EXISTS refund_percentage');
  }
}
