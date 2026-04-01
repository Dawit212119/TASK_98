export const DEFAULT_LOGIN_LOCK_THRESHOLD = 5;

export function computeLoginLockoutUntil(nowMs: number, lockMinutes: number): Date {
  return new Date(nowMs + lockMinutes * 60 * 1000);
}
