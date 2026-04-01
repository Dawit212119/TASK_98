import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [HealthController],
  providers: [HealthService]
})
export class HealthModule {}
