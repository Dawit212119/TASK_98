/**
 * Acceptance: workflow SLA expiry check extracted for clarity (pairs with business-hours deadline tests).
 */
import { isWorkflowDeadlinePassed } from '../src/modules/workflow/workflow-sla-expiry.util';

describe('isWorkflowDeadlinePassed', () => {
  it('is false when now is before deadline', () => {
    const deadline = new Date('2026-06-01T15:00:00.000Z');
    const now = new Date('2026-06-01T14:00:00.000Z');
    expect(isWorkflowDeadlinePassed(deadline, now)).toBe(false);
  });

  it('is true when now is after deadline', () => {
    const deadline = new Date('2026-06-01T15:00:00.000Z');
    const now = new Date('2026-06-01T16:00:00.000Z');
    expect(isWorkflowDeadlinePassed(deadline, now)).toBe(true);
  });
});
