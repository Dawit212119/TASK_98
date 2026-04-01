const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Whether the post-completion review window has elapsed (prompt: reviews within 14 days).
 */
export function isReviewWindowExpired(completionTime: Date, referenceMs: number = Date.now()): boolean {
  return referenceMs - completionTime.getTime() > FOURTEEN_DAYS_MS;
}
