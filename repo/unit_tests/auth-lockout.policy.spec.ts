/**
 * Acceptance: lockout duration policy — wall-clock lockout end; E2E “wait 15 minutes” documented in README (impractical in CI).
 */
import 'reflect-metadata';
import { computeLoginLockoutUntil } from '../src/modules/auth/auth-lockout.policy';
import { validateEnv } from '../src/config/env.validation';

describe('auth-lockout.policy', () => {
  it('computes lockout end from minutes', () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
    const until = computeLoginLockoutUntil(nowMs, 15);
    expect(until.getTime()).toBe(nowMs + 15 * 60 * 1000);
  });
});

describe('env validation secret hardening', () => {
  const baseEnv = {
    NODE_ENV: 'test',
    PORT: 3000,
    API_PREFIX: 'api/v1',
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_USERNAME: 'user',
    DB_PASSWORD: 'pass',
    DB_NAME: 'db',
    JWT_SECRET: 'Abcd1234!Abcd1234!Abcd1234!AbcdX',
    JWT_EXPIRES_IN_SECONDS: 3600,
    RESET_TOKEN_EXPIRES_IN_MINUTES: 15,
    IDENTITY_DOC_ENCRYPTION_KEY: 'Efgh1234!Efgh1234!Efgh1234!EfghX'
  };

  it('rejects weak/default jwt secret at startup validation', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        JWT_SECRET: 'change-me'
      })
    ).toThrow('JWT_SECRET is insecure');
  });

  it('rejects weak/default identity doc encryption key at startup validation', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        IDENTITY_DOC_ENCRYPTION_KEY: 'change-me-identity-doc-key'
      })
    ).toThrow('IDENTITY_DOC_ENCRYPTION_KEY is insecure');
  });
});
