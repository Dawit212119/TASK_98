import {
  assertPrivilegedAuditPayload,
  buildPrivilegedAuditPayload
} from '../src/modules/audit/privileged-audit.builder';

describe('buildPrivilegedAuditPayload', () => {
  it('produces correct shape with all fields including filters', () => {
    const result = buildPrivilegedAuditPayload({
      action: 'test.action',
      actorId: 'user-1',
      entityType: 'test_entity',
      entityId: 'entity-1',
      accessBasis: 'ops_admin',
      filters: { patient_id: 'p-1' },
      outcome: 'success'
    });

    expect(result).toEqual({
      action: 'test.action',
      actorId: 'user-1',
      entityType: 'test_entity',
      entityId: 'entity-1',
      payload: {
        access_basis: 'ops_admin',
        outcome: 'success',
        filters: { patient_id: 'p-1' }
      }
    });
  });

  it('always includes filters as an object when filters is empty', () => {
    const result = buildPrivilegedAuditPayload({
      action: 'test.action',
      actorId: 'user-1',
      entityType: 'test_entity',
      entityId: null,
      accessBasis: 'self',
      filters: {},
      outcome: 'success'
    });

    expect(result.payload).toEqual({
      access_basis: 'self',
      outcome: 'success',
      filters: {}
    });
  });

  it('defaults filters to {} when filters is undefined', () => {
    const result = buildPrivilegedAuditPayload({
      action: 'test.action',
      actorId: 'user-1',
      entityType: 'test_entity',
      entityId: null,
      accessBasis: 'staff',
      outcome: 'denied'
    });

    expect(result.payload.filters).toEqual({});
    expect(result.payload.outcome).toBe('denied');
  });

  it('merges extraPayload alongside standard fields', () => {
    const result = buildPrivilegedAuditPayload(
      {
        action: 'x.read',
        actorId: 'a1',
        entityType: 'ent',
        entityId: 'e1',
        accessBasis: 'permission_based',
        filters: { q: 1 },
        outcome: 'success'
      },
      { role_count: 3 }
    );

    expect(result.payload).toMatchObject({
      access_basis: 'permission_based',
      outcome: 'success',
      filters: { q: 1 },
      role_count: 3
    });
  });

  it('supports null entityId for aggregate operations', () => {
    const result = buildPrivilegedAuditPayload({
      action: 'aggregate.read',
      actorId: 'user-1',
      entityType: 'follow_up_adherence',
      entityId: null,
      accessBasis: 'analytics_viewer',
      filters: {},
      outcome: 'success'
    });

    expect(result.entityId).toBeNull();
  });
});

describe('assertPrivilegedAuditPayload', () => {
  it('accepts a valid privileged payload', () => {
    expect(() =>
      assertPrivilegedAuditPayload({
        access_basis: 'merchant',
        outcome: 'success',
        filters: { page: 1 }
      })
    ).not.toThrow();
  });

  it('throws when access_basis is missing or invalid', () => {
    expect(() =>
      assertPrivilegedAuditPayload({ outcome: 'success', filters: {} } as Record<string, unknown>)
    ).toThrow(/access_basis/);
    expect(() =>
      assertPrivilegedAuditPayload({
        access_basis: 'nope',
        outcome: 'success',
        filters: {}
      })
    ).toThrow(/access_basis/);
  });

  it('throws when outcome is not success or denied', () => {
    expect(() =>
      assertPrivilegedAuditPayload({
        access_basis: 'ops_admin',
        outcome: 'maybe',
        filters: {}
      } as Record<string, unknown>)
    ).toThrow(/outcome/);
  });

  it('throws when filters is not a plain object', () => {
    expect(() =>
      assertPrivilegedAuditPayload({
        access_basis: 'ops_admin',
        outcome: 'success',
        filters: null
      } as Record<string, unknown>)
    ).toThrow(/filters/);
    expect(() =>
      assertPrivilegedAuditPayload({
        access_basis: 'ops_admin',
        outcome: 'success',
        filters: [] as unknown as Record<string, unknown>
      })
    ).toThrow(/filters/);
  });
});
