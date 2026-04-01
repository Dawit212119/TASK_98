import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuditRetentionService } from '../modules/audit/audit-retention.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const retentionService = app.get(AuditRetentionService);
    const actorId = process.env.AUDIT_RETENTION_ACTOR_ID ?? null;
    const result = await retentionService.runProtectedRetentionJob(actorId);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await app.close();
  }
}

bootstrap().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
