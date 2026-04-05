import { SeedDevOpsAdmin1700000007000 } from '../src/database/migrations/1700000007000-SeedDevOpsAdmin';

describe('SeedDevOpsAdmin migration bootstrap validation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const buildQueryRunner = () => {
    const queries: Array<{ sql: string; params?: any[] }> = [];
    return {
      runner: {
        query: jest.fn(async (sql: string, params?: any[]) => {
          queries.push({ sql, params });
        })
      } as any,
      queries
    };
  };

  const validHash = '$2a$10$hntfIF4MDMrgaCzZfKleMODLnEow1MpKkej5SpW46ojX6PxhLs/bS';

  it('skips seeding when env vars are absent in non-production', async () => {
    delete process.env.BOOTSTRAP_OPS_USERNAME;
    delete process.env.BOOTSTRAP_OPS_PASSWORD_HASH;
    process.env.NODE_ENV = 'development';

    const migration = new SeedDevOpsAdmin1700000007000();
    const { runner, queries } = buildQueryRunner();

    await migration.up(runner);

    expect(queries).toHaveLength(0);
  });

  it('throws in production when env vars are missing', async () => {
    delete process.env.BOOTSTRAP_OPS_USERNAME;
    delete process.env.BOOTSTRAP_OPS_PASSWORD_HASH;
    process.env.NODE_ENV = 'production';

    const migration = new SeedDevOpsAdmin1700000007000();
    const { runner } = buildQueryRunner();

    await expect(migration.up(runner)).rejects.toThrow('BOOTSTRAP_OPS_USERNAME and BOOTSTRAP_OPS_PASSWORD_HASH must be set');
  });

  it('rejects weak username in production', async () => {
    process.env.BOOTSTRAP_OPS_USERNAME = 'dev_ops_admin';
    process.env.BOOTSTRAP_OPS_PASSWORD_HASH = validHash;
    process.env.NODE_ENV = 'production';

    const migration = new SeedDevOpsAdmin1700000007000();
    const { runner } = buildQueryRunner();

    await expect(migration.up(runner)).rejects.toThrow('not allowed in production');
  });

  it('rejects plaintext password (not a bcrypt hash)', async () => {
    process.env.BOOTSTRAP_OPS_USERNAME = 'secure_admin';
    process.env.BOOTSTRAP_OPS_PASSWORD_HASH = 'PlaintextPassword123!';
    process.env.NODE_ENV = 'development';

    const migration = new SeedDevOpsAdmin1700000007000();
    const { runner } = buildQueryRunner();

    await expect(migration.up(runner)).rejects.toThrow('must be a valid bcrypt hash');
  });

  it('seeds user with valid env vars (non-production)', async () => {
    process.env.BOOTSTRAP_OPS_USERNAME = 'my_admin';
    process.env.BOOTSTRAP_OPS_PASSWORD_HASH = validHash;
    delete process.env.BOOTSTRAP_OPS_SECURITY_ANSWER_HASH;
    process.env.NODE_ENV = 'development';

    const migration = new SeedDevOpsAdmin1700000007000();
    const { runner, queries } = buildQueryRunner();

    await migration.up(runner);

    // Should insert user + role (no security answer without env var)
    expect(queries).toHaveLength(2);
    expect(queries[0]!.sql).toContain('INSERT INTO users');
    expect(queries[0]!.params).toContain('my_admin');
    expect(queries[1]!.sql).toContain('INSERT INTO user_roles');
  });

  it('seeds user with security answer when env var provided', async () => {
    process.env.BOOTSTRAP_OPS_USERNAME = 'my_admin';
    process.env.BOOTSTRAP_OPS_PASSWORD_HASH = validHash;
    process.env.BOOTSTRAP_OPS_SECURITY_ANSWER_HASH = validHash;
    process.env.NODE_ENV = 'development';

    const migration = new SeedDevOpsAdmin1700000007000();
    const { runner, queries } = buildQueryRunner();

    await migration.up(runner);

    // user + security_answer + role
    expect(queries).toHaveLength(3);
    expect(queries[1]!.sql).toContain('security_answers');
  });

  it('allows non-weak username in production', async () => {
    process.env.BOOTSTRAP_OPS_USERNAME = 'prod_operations_lead';
    process.env.BOOTSTRAP_OPS_PASSWORD_HASH = validHash;
    process.env.NODE_ENV = 'production';

    const migration = new SeedDevOpsAdmin1700000007000();
    const { runner, queries } = buildQueryRunner();

    await migration.up(runner);

    expect(queries.length).toBeGreaterThanOrEqual(2);
  });

  it('down is no-op when username env var is missing', async () => {
    delete process.env.BOOTSTRAP_OPS_USERNAME;

    const migration = new SeedDevOpsAdmin1700000007000();
    const { runner, queries } = buildQueryRunner();

    await migration.down(runner);

    expect(queries).toHaveLength(0);
  });
});
