/**
 * Standardized builder for privileged-operation audit payloads.
 *
 * Every privileged access path must emit an audit record containing:
 *   actor_id, action, entity_type, entity_id, access_basis,
 *   outcome ("success" | "denied"), filters (object, may be empty),
 *   plus optional domain fields via extraPayload.
 *
 * This builder enforces that shape at the call-site so audit records
 * are consistent across domains without copy-pasting boilerplate.
 */

const ACCESS_BASIS_VALUES = new Set([
  'self',
  'staff',
  'ops_admin',
  'provider',
  'merchant',
  'analytics_viewer',
  'permission_based'
]);

export type AccessBasis =
  | 'self'
  | 'staff'
  | 'ops_admin'
  | 'provider'
  | 'merchant'
  | 'analytics_viewer'
  | 'permission_based';

export interface PrivilegedAuditInput {
  /** Audit action identifier, e.g. 'follow_up.adherence.read' */
  action: string;
  /** Actor (user) performing the privileged operation */
  actorId: string;
  /** Entity type being accessed */
  entityType: string;
  /** Entity id (null when the operation is aggregate / not resource-specific) */
  entityId: string | null;
  /** Why the actor has access */
  accessBasis: AccessBasis;
  /** Request-level filters or resource identifiers (always stored; use {} when none) */
  filters?: Record<string, unknown>;
  /** Short outcome description */
  outcome: 'success' | 'denied';
}

/**
 * Validates payload shape for privileged audit entries (for tests and optional tooling).
 * Throws if access_basis, outcome, or filters are missing or malformed.
 */
export function assertPrivilegedAuditPayload(payload: Record<string, unknown>): void {
  if (typeof payload.access_basis !== 'string' || !ACCESS_BASIS_VALUES.has(payload.access_basis)) {
    throw new Error(
      `Privileged audit payload missing or invalid access_basis: ${String(payload.access_basis)}`
    );
  }
  if (payload.outcome !== 'success' && payload.outcome !== 'denied') {
    throw new Error(`Privileged audit payload missing or invalid outcome: ${String(payload.outcome)}`);
  }
  if (
    typeof payload.filters !== 'object' ||
    payload.filters === null ||
    Array.isArray(payload.filters)
  ) {
    throw new Error('Privileged audit payload must include filters as a plain object');
  }
}

/**
 * Builds the object accepted by AuditService.appendLog while
 * embedding the privileged-access metadata inside the JSONB payload column.
 *
 * @param extraPayload Optional domain-specific fields merged alongside access_basis / outcome / filters.
 */
export function buildPrivilegedAuditPayload(
  input: PrivilegedAuditInput,
  extraPayload?: Record<string, unknown>
): {
  action: string;
  actorId: string;
  entityType: string;
  entityId: string | null;
  payload: Record<string, unknown>;
} {
  const filters: Record<string, unknown> = { ...(input.filters ?? {}) };
  const payload: Record<string, unknown> = {
    access_basis: input.accessBasis,
    outcome: input.outcome,
    filters,
    ...(extraPayload ?? {})
  };
  assertPrivilegedAuditPayload(payload);
  return {
    action: input.action,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    payload
  };
}
