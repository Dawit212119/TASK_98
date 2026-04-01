import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Observable, from, of, switchMap } from 'rxjs';
import { IDEMPOTENT_KEY } from '../../common/decorators/idempotent.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { RequestWithContext } from '../../common/types/request-with-context';
import { AuthService } from '../auth/auth.service';
import { IdempotencyService } from './idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotencyService: IdempotencyService,
    private readonly authService: AuthService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const idempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!idempotent) {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<RequestWithContext>();
    const response = httpContext.getResponse<{ status: (statusCode: number) => void; statusCode: number }>();
    const keyHeader = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;

    if (!idempotencyKey) {
      throw new AppException('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', {}, 400);
    }

    const endpoint = `${request.method}:${request.originalUrl.split('?')[0]}`;
    const requestHash = createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex');

    return from(this.idempotencyService.findByKeyAndEndpoint(idempotencyKey, endpoint)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash && existing.requestHash !== requestHash) {
            throw new AppException(
              'IDEMPOTENCY_KEY_CONFLICT',
              'Idempotency-Key has already been used with a different payload',
              {},
              409
            );
          }

          return from(this.hydrateIdempotentRegisterBody(endpoint, existing.responseBody)).pipe(
            switchMap((body) => {
              response.status(existing.responseStatus ?? 200);
              return of(body);
            })
          );
        }

        return next.handle().pipe(
          switchMap((handlerResponse) =>
            from(
              this.idempotencyService.saveResult({
                key: idempotencyKey,
                endpoint,
                requestHash,
                responseStatus: response.statusCode,
                responseBody: handlerResponse
              })
            ).pipe(switchMap(() => of(handlerResponse)))
          )
        );
      })
    );
  }

  /**
   * Older idempotency rows for POST /auth/register may omit access_token; replay must still return a session.
   */
  private async hydrateIdempotentRegisterBody(endpoint: string, responseBody: unknown): Promise<unknown> {
    const body: unknown = responseBody ?? null;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !endpoint.endsWith('/auth/register')
    ) {
      return body;
    }

    const rec = body as Record<string, unknown>;
    const userId = rec.user_id;
    const token = rec.access_token;
    if (typeof userId !== 'string' || (typeof token === 'string' && token.length > 0)) {
      return body;
    }

    const auth = await this.authService.issueAuthenticatedSession(userId);
    return { ...rec, ...auth };
  }
}
