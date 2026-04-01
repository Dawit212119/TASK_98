import { MigrationInterface, QueryRunner } from 'typeorm';

/** Patient-created reservations had no reservation_data_scopes until createReservation called ensureDefaultClinicReservationScope. */
export class BackfillReservationDefaultScope1700000012000 implements MigrationInterface {
  name = 'BackfillReservationDefaultScope1700000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO reservation_data_scopes (reservation_id, scope_id)
      SELECT r.id, ds.id
      FROM reservations r
      CROSS JOIN data_scopes ds
      WHERE ds.scope_key = 'default_clinic'
        AND ds.deleted_at IS NULL
        AND r.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM reservation_data_scopes rds
          WHERE rds.reservation_id = r.id
            AND rds.deleted_at IS NULL
        )
      ON CONFLICT (reservation_id, scope_id) DO NOTHING
    `);

  }

  public async down(): Promise<void> {
    // Non-reversible: cannot know which rows were backfilled vs created at reservation time.
  }
}
