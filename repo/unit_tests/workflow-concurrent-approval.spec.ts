/**
 * Unit tests for workflow approval util functions.
 * Covers empty-approval edge cases and same-user duplicate rejection.
 */
import {
  isAnyOneStepSatisfied,
  isAllRequiredStepSatisfied,
  WorkflowSlot,
  WorkflowApprovalRow
} from '../src/modules/workflow/workflow-approval.util';

describe('isAnyOneStepSatisfied', () => {
  const slots: WorkflowSlot[] = [{ id: 'slot-1', approverRole: 'manager' }];

  it('returns false when approvals array is empty', () => {
    const rolesByUserId: Record<string, string[]> = {};
    expect(isAnyOneStepSatisfied(slots, [], rolesByUserId)).toBe(false);
  });

  it('returns false when slots array is empty', () => {
    const approvals: WorkflowApprovalRow[] = [{ approverUserId: 'user-1' }];
    const rolesByUserId = { 'user-1': ['manager'] };
    expect(isAnyOneStepSatisfied([], approvals, rolesByUserId)).toBe(false);
  });

  it('returns true when approver has the required role', () => {
    const approvals: WorkflowApprovalRow[] = [{ approverUserId: 'user-1' }];
    const rolesByUserId = { 'user-1': ['manager'] };
    expect(isAnyOneStepSatisfied(slots, approvals, rolesByUserId)).toBe(true);
  });
});

describe('isAllRequiredStepSatisfied', () => {
  const slots: WorkflowSlot[] = [
    { id: 'slot-1', approverRole: 'manager' },
    { id: 'slot-2', approverRole: 'director' }
  ];

  it('returns false when approvals array is empty', () => {
    expect(isAllRequiredStepSatisfied(slots, [], {})).toBe(false);
  });

  it('requires two distinct users — same-user duplicate is rejected', () => {
    // Both slots approved by the same user: should not satisfy ALL_REQUIRED
    const approvals: WorkflowApprovalRow[] = [
      { approverUserId: 'user-1' },
      { approverUserId: 'user-1' }
    ];
    const rolesByUserId = { 'user-1': ['manager', 'director'] };
    expect(isAllRequiredStepSatisfied(slots, approvals, rolesByUserId)).toBe(false);
  });

  it('returns true when two distinct users satisfy both slots', () => {
    const approvals: WorkflowApprovalRow[] = [
      { approverUserId: 'user-1' },
      { approverUserId: 'user-2' }
    ];
    const rolesByUserId = {
      'user-1': ['manager'],
      'user-2': ['director']
    };
    expect(isAllRequiredStepSatisfied(slots, approvals, rolesByUserId)).toBe(true);
  });

  it('ops_admin can satisfy any slot', () => {
    const approvals: WorkflowApprovalRow[] = [
      { approverUserId: 'admin-1' },
      { approverUserId: 'admin-2' }
    ];
    const rolesByUserId = {
      'admin-1': ['ops_admin'],
      'admin-2': ['ops_admin']
    };
    expect(isAllRequiredStepSatisfied(slots, approvals, rolesByUserId)).toBe(true);
  });
});
