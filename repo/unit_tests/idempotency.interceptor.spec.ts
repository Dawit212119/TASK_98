/**
 * Idempotency interceptor tests.
 *
 * Covers:
 *  - missing header → 400
 *  - same key + same payload → returns cached response
 *  - same key + different payload → 409 IDEMPOTENCY_KEY_CONFLICT
 *  - actor isolation: two different users with the same key+endpoint each get
 *    their own independent cached slot (User B cannot replay User A's result).
 */
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { AppException } from '../src/common/exceptions/app.exception';
import { IdempotencyInterceptor } from '../src/modules/idempotency/idempotency.interceptor';

type HttpRequestMock = {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
  user?: { userId: string; sessionId: string; jti: string };
};

type HttpResponseMock = {
  statusCode: number;
  status: (statusCode: number) => void;
};

const createExecutionContext = (request: HttpRequestMock, response: HttpResponseMock): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response
    })
  }) as unknown as ExecutionContext;

describe('IdempotencyInterceptor', () => {
  const reflector = {
    getAllAndOverride: jest.fn(() => true)
  } as unknown as Reflector;

  const authService = {
    issueAuthenticatedSession: jest.fn()
  };

  it('throws when Idempotency-Key header is missing', async () => {
    const idempotencyService = {
      findByKeyEndpointAndActor: jest.fn(),
      saveResult: jest.fn().mockResolvedValue(undefined)
    };

    const interceptor = new IdempotencyInterceptor(reflector, idempotencyService as any, authService as any);

    const request: HttpRequestMock = {
      method: 'POST',
      originalUrl: '/api/v1/sync/push',
      headers: {},
      body: {}
    };
    const response: HttpResponseMock = {
      statusCode: 200,
      status: jest.fn()
    };

    const next: CallHandler = {
      handle: () => of({ ok: true })
    };

    expect(() => interceptor.intercept(createExecutionContext(request, response), next)).toThrow(AppException);
    expect(() => interceptor.intercept(createExecutionContext(request, response), next)).toThrow(
      'Idempotency-Key header is required'
    );
  });

  it('returns cached response for same key and payload', async () => {
    const idempotencyService = {
      findByKeyEndpointAndActor: jest.fn(async () => ({
        requestHash: '',
        responseStatus: 201,
        responseBody: { cached: true }
      })),
      saveResult: jest.fn()
    };

    const interceptor = new IdempotencyInterceptor(reflector, idempotencyService as any, authService as any);

    const request: HttpRequestMock = {
      method: 'POST',
      originalUrl: '/api/v1/auth/register',
      headers: { 'idempotency-key': 'abc-1' },
      body: { username: 'john' }
    };
    const response: HttpResponseMock = {
      statusCode: 200,
      status: jest.fn()
    };

    const next: CallHandler = {
      handle: jest.fn(() => of({ from_handler: true }))
    };

    const result = await lastValueFrom(interceptor.intercept(createExecutionContext(request, response), next));

    expect(result).toEqual({ cached: true });
    expect(response.status).toHaveBeenCalledWith(201);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('throws 409 when key exists but request body hash differs', async () => {
    const idempotencyService = {
      findByKeyEndpointAndActor: jest.fn(async () => ({
        requestHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        responseStatus: 201,
        responseBody: { first: true }
      })),
      saveResult: jest.fn().mockResolvedValue(undefined)
    };

    const interceptor = new IdempotencyInterceptor(reflector, idempotencyService as any, authService as any);

    const request: HttpRequestMock = {
      method: 'POST',
      originalUrl: '/api/v1/auth/register',
      headers: { 'idempotency-key': 'conflict-key' },
      body: { username: 'other' }
    };
    const response: HttpResponseMock = {
      statusCode: 200,
      status: jest.fn()
    };
    const next: CallHandler = { handle: () => of({ ok: true }) };

    let err: unknown;
    try {
      await lastValueFrom(interceptor.intercept(createExecutionContext(request, response), next));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect((err as AppException).getStatus()).toBe(409);
  });

  describe('actor isolation', () => {
    /**
     * Simulates a store keyed by (key, endpoint, actorUserId).
     * Returns the stored record for the exact actor, null for any other actor.
     */
    const makeActorIsolatedStore = (storedActorId: string | null) => {
      const stored = {
        // Empty requestHash — cache hit skips the hash-conflict check.
        requestHash: '',
        responseStatus: 201,
        responseBody: { owner: storedActorId }
      };
      return {
        findByKeyEndpointAndActor: jest.fn(async (_key: string, _ep: string, actorUserId: string | null) =>
          actorUserId === storedActorId ? stored : null
        ),
        saveResult: jest.fn().mockResolvedValue(undefined)
      };
    };

    it('user-A cached result is not replayed for user-B with the same key+endpoint', async () => {
      const USER_A = 'user-aaaa-1111-4111-8111-aaaaaaaaaaaa';
      const USER_B = 'user-bbbb-2222-4222-8222-bbbbbbbbbbbb';

      const idempotencyService = makeActorIsolatedStore(USER_A);
      const interceptor = new IdempotencyInterceptor(reflector, idempotencyService as any, authService as any);

      const sharedKey = 'shared-idempotency-key';

      // User B sends a request with the same key — should NOT hit user A's cache.
      const requestB: HttpRequestMock = {
        method: 'POST',
        originalUrl: '/api/v1/support/tickets',
        headers: { 'idempotency-key': sharedKey },
        body: { category: 'billing', description: 'test' },
        user: { userId: USER_B, sessionId: 'sess-B', jti: 'jti-B' }
      };
      const responseB: HttpResponseMock = { statusCode: 200, status: jest.fn() };
      const handlerBResult = { ticket_id: 'new-ticket-for-B' };
      const nextB: CallHandler = { handle: jest.fn(() => of(handlerBResult)) };

      const result = await lastValueFrom(interceptor.intercept(createExecutionContext(requestB, responseB), nextB));

      // Handler was called — cache miss for user B (not replaying user A's result).
      expect(nextB.handle).toHaveBeenCalled();
      expect(result).toEqual(handlerBResult);

      // Verify findByKeyEndpointAndActor was called with user B's ID.
      expect(idempotencyService.findByKeyEndpointAndActor).toHaveBeenCalledWith(
        sharedKey,
        expect.stringContaining('/support/tickets'),
        USER_B
      );
    });

    it('user-A can still replay their own cached result using the same key', async () => {
      const USER_A = 'user-aaaa-1111-4111-8111-aaaaaaaaaaaa';

      const idempotencyService = makeActorIsolatedStore(USER_A);
      const interceptor = new IdempotencyInterceptor(reflector, idempotencyService as any, authService as any);

      const requestA: HttpRequestMock = {
        method: 'POST',
        originalUrl: '/api/v1/support/tickets',
        headers: { 'idempotency-key': 'shared-idempotency-key' },
        body: { category: 'billing', description: 'test' },
        user: { userId: USER_A, sessionId: 'sess-A', jti: 'jti-A' }
      };
      const responseA: HttpResponseMock = { statusCode: 200, status: jest.fn() };
      const nextA: CallHandler = { handle: jest.fn(() => of({ should_not_see: true })) };

      const result = await lastValueFrom(interceptor.intercept(createExecutionContext(requestA, responseA), nextA));

      // Cache hit — handler not called.
      expect(nextA.handle).not.toHaveBeenCalled();
      expect((result as Record<string, unknown>).owner).toBe(USER_A);
    });

    it('passes null actorUserId for unauthenticated (public) endpoints', async () => {
      const idempotencyService = {
        findByKeyEndpointAndActor: jest.fn().mockResolvedValue(null),
        saveResult: jest.fn().mockResolvedValue(undefined)
      };
      const interceptor = new IdempotencyInterceptor(reflector, idempotencyService as any, authService as any);

      const request: HttpRequestMock = {
        method: 'POST',
        originalUrl: '/api/v1/auth/register',
        headers: { 'idempotency-key': 'public-key' },
        body: { username: 'alice' }
        // no `user` property — unauthenticated
      };
      const response: HttpResponseMock = { statusCode: 201, status: jest.fn() };
      const next: CallHandler = { handle: jest.fn(() => of({ user_id: 'new-user' })) };

      await lastValueFrom(interceptor.intercept(createExecutionContext(request, response), next));

      expect(idempotencyService.findByKeyEndpointAndActor).toHaveBeenCalledWith(
        'public-key',
        expect.any(String),
        null   // no actor for public endpoint
      );
      expect(idempotencyService.saveResult).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: null })
      );
    });
  });
});
