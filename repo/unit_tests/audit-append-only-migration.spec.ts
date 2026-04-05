/**
 * Static guard: audit_logs append-only triggers must remain in the canonical migration.
 * (Runtime enforcement still requires PostgreSQL; this catches accidental deletion from source.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Audit logs append-only migration (static)', () => {
  const migrationPath = join(
    __dirname,
    '../src/database/migrations/1700000015000-AuditLogsAppendOnly.ts'
  );

  it('defines prevent_audit_log_mutation and UPDATE/DELETE triggers', () => {
    const src = readFileSync(migrationPath, 'utf8');
    expect(src).toContain('prevent_audit_log_mutation');
    expect(src).toContain('BEFORE UPDATE ON audit_logs');
    expect(src).toContain('BEFORE DELETE ON audit_logs');
    expect(src).toContain('trg_audit_logs_no_update');
    expect(src).toContain('trg_audit_logs_no_delete');
  });
});
