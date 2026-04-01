/**
 * Acceptance gaps: idempotency — same key + different body must surface 409 IDEMPOTENCY_KEY_CONFLICT.
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
      findByKeyAndEndpoint: jest.fn(),
      saveResult: jest.fn()
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
      findByKeyAndEndpoint: jest.fn(async () => ({
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
      findByKeyAndEndpoint: jest.fn(async () => ({
        requestHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        responseStatus: 201,
        responseBody: { first: true }
      })),
      saveResult: jest.fn()
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
});
