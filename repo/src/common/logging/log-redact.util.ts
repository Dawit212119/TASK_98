/** Categories for structured application logs (prefix / routing to log sinks). */
export const LogCategory = {
  HTTP: 'http',
  SECURITY: 'security',
  AUDIT: 'audit',
  BUSINESS: 'business'
} as const;

export type LogCategoryValue = (typeof LogCategory)[keyof typeof LogCategory];

const SENSITIVE_KEY =
  /^(password|passwd|pwd|token|access_token|refresh_token|secret|authorization|cookie|session|security_answer)$/i;

/**
 * Recursively redact common secret fields before logging (never log raw credentials).
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[max-depth]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactForLog(v, depth + 1);
    }
  }
  return out;
}
