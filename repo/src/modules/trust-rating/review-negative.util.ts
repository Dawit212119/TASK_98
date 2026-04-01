/**
 * Appeals (trust.appeal.create) are restricted to reviews that qualify as "negative".
 *
 * Rule (1–5 scores per dimension): negative iff **any** dimension has `score <= 2`.
 * Deterministic, documented, and aligned with "low scores indicate a problem" semantics.
 */
export function isNegativeReviewDimensions(
  dimensions: Array<Record<string, unknown> & { score?: unknown }> | null | undefined
): boolean {
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    return false;
  }
  return dimensions.some((d) => typeof d?.score === 'number' && d.score <= 2);
}
