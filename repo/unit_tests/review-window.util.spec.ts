/**
 * Acceptance: API gap — 14-day review window boundary (static; real API time travel impractical).
 */
import { isReviewWindowExpired } from '../src/modules/trust-rating/review-window.util';

describe('isReviewWindowExpired', () => {
  it('is false at exactly 14 days after completion', () => {
    const completion = new Date('2026-01-01T12:00:00.000Z');
    const ref = completion.getTime() + 14 * 24 * 60 * 60 * 1000;
    expect(isReviewWindowExpired(completion, ref)).toBe(false);
  });

  it('is true just after 14 days', () => {
    const completion = new Date('2026-01-01T12:00:00.000Z');
    const ref = completion.getTime() + 14 * 24 * 60 * 60 * 1000 + 1;
    expect(isReviewWindowExpired(completion, ref)).toBe(true);
  });
});
