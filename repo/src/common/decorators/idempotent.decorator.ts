import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Marks a route as idempotency-protected (interceptor) and documents the required
 * `Idempotency-Key` header in OpenAPI / Swagger UI.
 */
export const Idempotent = (): MethodDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description:
        'Fresh UUID per logical operation (generate a new one in Swagger for each new registration). Reusing the same key+endpoint+body replays the **first** stored JSON — if that was saved before an API change (e.g. old register without tokens), you keep seeing that stale body; use a new key. Same key with a different body → 409. Omitting header → 400 IDEMPOTENCY_KEY_REQUIRED.',
      schema: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }
    })
  );
