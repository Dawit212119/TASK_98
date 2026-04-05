import { AppException } from '../src/common/exceptions/app.exception';
import { AuthService } from '../src/modules/auth/auth.service';

describe('AuthService.refreshTokens', () => {
  const userId = 'user-11111111-1111-4111-8111-111111111111';
  const sessionId = 'sess-22222222-2222-4222-8222-222222222222';
  const refreshPlain = 'a'.repeat(64);

  function buildService() {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    const hash = createHash('sha256').update(refreshPlain).digest('hex');
    const future = new Date(Date.now() + 3600_000);

    const sessionRepository = {
      findOne: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (where.id === sessionId && where.refreshTokenHash === hash) {
          return Promise.resolve({
            id: sessionId,
            userId,
            tokenJti: 'old-jti',
            refreshTokenHash: hash,
            expiresAt: future,
            invalidatedAt: null,
            deletedAt: null,
            version: 1
          });
        }
        return Promise.resolve(null);
      }),
      save: jest.fn(async (s: unknown) => s)
    };

    const jwtService = {
      signAccessToken: jest.fn(() => 'new.jwt.token')
    };

    const configService = {
      getOrThrow: jest.fn((k: string) => {
        if (k === 'JWT_EXPIRES_IN_SECONDS') {
          return 3600;
        }
        throw new Error(`unexpected ${k}`);
      }),
      get: jest.fn((k: string) => (k === 'JWT_REFRESH_EXPIRES_IN_SECONDS' ? 604800 : undefined))
    };

    const service = new AuthService(
      {} as any,
      configService as any,
      jwtService as any,
      {} as any,
      {} as any,
      sessionRepository as any,
      {} as any,
      {} as any,
      {} as any
    );

    return { service, sessionRepository, jwtService };
  }

  it('returns new tokens when refresh hash and session match', async () => {
    const { service, jwtService, sessionRepository } = buildService();

    const out = await service.refreshTokens({ session_id: sessionId, refresh_token: refreshPlain });

    expect(out.access_token).toBe('new.jwt.token');
    expect(out.session_id).toBe(sessionId);
    expect(out.refresh_token).toHaveLength(64);
    expect(jwtService.signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: userId, session_id: sessionId })
    );
    expect(sessionRepository.save).toHaveBeenCalled();
  });

  it('rejects invalid refresh token', async () => {
    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn()
    };
    const service = new AuthService(
      {} as any,
      {
        getOrThrow: jest.fn(() => 3600),
        get: jest.fn()
      } as any,
      { signAccessToken: jest.fn() } as any,
      {} as any,
      {} as any,
      sessionRepository as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(
      service.refreshTokens({ session_id: sessionId, refresh_token: 'b'.repeat(64) })
    ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' } as AppException);
  });
});
