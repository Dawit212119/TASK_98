import 'reflect-metadata';
import { validateEnv } from '../src/config/env.validation';

describe('env.validation – throttle config', () => {
  const baseEnv: Record<string, unknown> = {
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'postgres',
    DB_NAME: 'carereserve',
    JWT_SECRET: 'ABCDEFGHIJKLMNOPQRSTUVWXyz1234567890!@#$',
    JWT_EXPIRES_IN_SECONDS: 3600,
    RESET_TOKEN_EXPIRES_IN_MINUTES: 30,
    IDENTITY_DOC_ENCRYPTION_KEY: 'ZYXWVUTSRQPONMLKJIhgfedcba09876543210!@#$'
  };

  it('accepts valid THROTTLE_TTL and THROTTLE_LIMIT', () => {
    const result = validateEnv({ ...baseEnv, THROTTLE_TTL: 30000, THROTTLE_LIMIT: 60 });
    expect(result.THROTTLE_TTL).toBe(30000);
    expect(result.THROTTLE_LIMIT).toBe(60);
  });

  it('passes without THROTTLE_TTL and THROTTLE_LIMIT (optional)', () => {
    const result = validateEnv({ ...baseEnv });
    expect(result.THROTTLE_TTL).toBeUndefined();
    expect(result.THROTTLE_LIMIT).toBeUndefined();
  });

  it('rejects THROTTLE_TTL below 1000ms', () => {
    expect(() => validateEnv({ ...baseEnv, THROTTLE_TTL: 500 })).toThrow();
  });

  it('rejects THROTTLE_LIMIT below 1', () => {
    expect(() => validateEnv({ ...baseEnv, THROTTLE_LIMIT: 0 })).toThrow();
  });
});
