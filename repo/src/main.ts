import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { json, urlencoded, type Request, type Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Disable Nest's default body-parser (small default limit) so large JSON and multipart uploads are not rejected with 413 before multer runs.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false
  });
  const bootstrapLogger = new Logger('[http] Bootstrap');
  app.useLogger(bootstrapLogger);

  app.use(helmet());
  app.enableCors({
    origin: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    credentials: true,
  });

  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ limit: '25mb', extended: true }));

  app.use((req: { requestId?: string }, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  const apiPrefix = process.env.API_PREFIX ?? 'api/v1';
  const normalizedPrefix = apiPrefix.startsWith('/') ? apiPrefix : `/${apiPrefix}`;
  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true }
    })
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CareReserve API')
    .setDescription(
      'CareReserve modular monolith API. Complements docs/api-spec.md. Try it out uses this host; route paths already include the configured API prefix.'
    )
    .setVersion('1.0.0')
    // Server is "/" only: Nest embeds globalPrefix in each path (e.g. /api/v1/auth/register). addServer("/api/v1") would produce /api/v1/api/v1/... in Swagger UI.
    .addServer('/', 'This host (paths include API prefix)')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
        description: 'Authorization: Bearer <token>'
      },
      'bearer'
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig, {
    deepScanRoutes: true
  });
  // Mount under the same global prefix as controllers (e.g. /api/v1/docs), not /api/docs —
  // otherwise Swagger path and static assets do not match what people expect when API_PREFIX=api/v1.
  SwaggerModule.setup('docs', app, swaggerDocument, {
    useGlobalPrefix: true,
    swaggerOptions: {
      persistAuthorization: true
    }
  });

  const swaggerPath = `${normalizedPrefix}/docs`.replace(/\/{2,}/g, '/');
  // Common mistake: /api/docs — Swagger actually lives under the same prefix as the API (e.g. /api/v1/docs).
  const httpServer = app.getHttpAdapter().getInstance();
  httpServer.get('/api/docs', (_req: Request, res: Response) => {
    res.redirect(302, swaggerPath);
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  bootstrapLogger.log(
    `Listening on port ${port} — Swagger UI: http://localhost:${port}${swaggerPath} (redirect from /api/docs)`
  );
}

void bootstrap().catch((err: unknown) => {
  const logger = new Logger('[http] Bootstrap');
  logger.error(
    'Application failed to start',
    err instanceof Error ? err.stack : JSON.stringify(err)
  );
  process.exit(1);
});
