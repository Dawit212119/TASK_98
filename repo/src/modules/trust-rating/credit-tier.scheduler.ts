import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { TrustRatingService } from './trust-rating.service';

@Injectable()
export class CreditTierScheduler {
  private readonly logger = new Logger(CreditTierScheduler.name);

  constructor(
    private readonly trustRatingService: TrustRatingService,
    private readonly configService: ConfigService
  ) {}

  /** 03:00 UTC daily — recomputes credit tiers from rolling review scores. */
  @Cron('0 3 * * *')
  async runNightlyCreditTierJob(): Promise<void> {
    if (this.configService.get<string>('TRUST_CREDIT_TIER_CRON_ENABLED') === 'false') {
      return;
    }
    try {
      await this.trustRatingService.runNightlyCreditTierComputation();
      this.logger.log('Credit tier nightly computation completed');
    } catch (err: unknown) {
      this.logger.error(
        'Credit tier nightly computation failed',
        err instanceof Error ? err.stack : String(err)
      );
    }
  }
}
