/**
 * Acceptance: sensitive data / log categorization — ensure redaction utility strips credentials from log payloads.
 */
import { redactForLog } from '../src/common/logging/log-redact.util';

describe('redactForLog', () => {
  it('redacts password, token, and security_answer keys recursively', () => {
    const input = {
      username: 'alice',
      password: 'secret123',
      security_answer: 'blue',
      nested: { access_token: 'jwt-here', ok: true }
    };
    const out = redactForLog(input) as Record<string, unknown>;
    expect(out.password).toBe('[REDACTED]');
    expect(out.security_answer).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).access_token).toBe('[REDACTED]');
    expect(out.username).toBe('alice');
    expect((out.nested as Record<string, unknown>).ok).toBe(true);
  });
});
