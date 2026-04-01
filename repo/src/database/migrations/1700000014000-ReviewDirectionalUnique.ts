import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReviewDirectionalUnique1700000014000 implements MigrationInterface {
  name = 'ReviewDirectionalUnique1700000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_reservation_direction_active
      ON reviews (reservation_id, reviewer_user_id, target_user_id)
      WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS uq_reviews_reservation_direction_active');
  }
}
