import { isNegativeReviewDimensions } from '../src/modules/trust-rating/review-negative.util';

describe('isNegativeReviewDimensions', () => {
  it('is false when any dimension is missing or empty', () => {
    expect(isNegativeReviewDimensions(undefined)).toBe(false);
    expect(isNegativeReviewDimensions([])).toBe(false);
  });

  it('is false when all scores are 3 or higher', () => {
    expect(isNegativeReviewDimensions([{ name: 'a', score: 3 }, { name: 'b', score: 5 }])).toBe(false);
  });

  it('is true when any score is 2', () => {
    expect(isNegativeReviewDimensions([{ name: 'care', score: 2 }])).toBe(true);
  });

  it('is true when any score is 1', () => {
    expect(isNegativeReviewDimensions([{ name: 'care', score: 5 }, { name: 'wait', score: 1 }])).toBe(true);
  });

  it('ignores non-numeric score entries', () => {
    expect(isNegativeReviewDimensions([{ name: 'x', score: '2' as unknown as number }])).toBe(false);
  });
});
