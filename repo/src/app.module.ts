import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AuthModule } from './modules/auth/auth.module';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { ReservationModule } from './modules/reservation/reservation.module';
import { FollowUpModule } from './modules/follow-up/follow-up.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { TrustRatingModule } from './modules/trust-rating/trust-rating.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SyncModule } from './modules/sync/sync.module';
import { FileModule } from './modules/file/file.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { validateEnv } from './config/env.validation';
import { typeOrmAsyncConfig } from './database/typeorm.config';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: config.get<number>('THROTTLE_TTL') ?? 60000,
        limit: config.get<number>('THROTTLE_LIMIT') ?? 120
      }])
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync(typeOrmAsyncConfig),
    IdempotencyModule,
    HealthModule,
    AuthModule,
    AccessControlModule,
    ReservationModule,
    FollowUpModule,
    CommunicationModule,
    TrustRatingModule,
    WorkflowModule,
    AnalyticsModule,
    SyncModule,
    FileModule,
    AuditModule
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ]
})
export class AppModule {}
