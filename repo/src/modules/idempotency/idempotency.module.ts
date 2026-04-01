import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyKeyEntity } from './idempotency-key.entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService } from './idempotency.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyKeyEntity]), AuthModule],
  providers: [
    IdempotencyService,
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor
    }
  ],
  exports: [IdempotencyService]
})
export class IdempotencyModule {}
