/**
 * Acceptance: login/register payloads must never be logged verbatim — AuthService has no Logger;
 * any future request logging must pipe through redactForLog (see also log-redact.util.spec).
 */
import { redactForLog } from '../src/common/logging/log-redact.util';

describe('auth credential fields redaction', () => {
  it('redacts typical login and register body shapes', () => {
    const loginLike = { username: 'u1', password: 'PlaintextPass123!' };
    const registerLike = {
      username: 'u2',
      password: 'RegPass123!',
      security_answer: 'should-hide',
      role: 'patient'
    };
    expect((redactForLog(loginLike) as Record<string, unknown>).password).toBe('[REDACTED]');
    const reg = redactForLog(registerLike) as Record<string, unknown>;
    expect(reg.password).toBe('[REDACTED]');
    expect(reg.security_answer).toBe('[REDACTED]');
  });
});
