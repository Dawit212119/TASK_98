import { isAllRequiredStepSatisfied, isAnyOneStepSatisfied } from '../src/modules/workflow/workflow-approval.util';

describe('workflow-approval.util', () => {
  const roles: Record<string, string[]> = {
    'staff-1': ['staff'],
    'staff-2': ['staff'],
    'prov-1': ['provider'],
    'ops-1': ['ops_admin'],
    patient: ['patient']
  };

  describe('isAnyOneStepSatisfied', () => {
    it('is false with no approvals', () => {
      expect(isAnyOneStepSatisfied([{ id: 's1', approverRole: 'staff' }], [], roles)).toBe(false);
    });

    it('completes on first eligible staff approval', () => {
      expect(
        isAnyOneStepSatisfied([{ id: 's1', approverRole: 'staff' }], [{ approverUserId: 'staff-1' }], roles)
      ).toBe(true);
    });

    it('completes when ops_admin approves', () => {
      expect(
        isAnyOneStepSatisfied([{ id: 's1', approverRole: 'staff' }], [{ approverUserId: 'ops-1' }], roles)
      ).toBe(true);
    });

    it('is false when approver has no matching role', () => {
      expect(
        isAnyOneStepSatisfied([{ id: 's1', approverRole: 'staff' }], [{ approverUserId: 'patient' }], roles)
      ).toBe(false);
    });
  });

  describe('isAllRequiredStepSatisfied', () => {
    const twoSlots = [
      { id: 'b', approverRole: 'staff' },
      { id: 'a', approverRole: 'provider' }
    ];

    it('is false after only one of two distinct slots is approved', () => {
      expect(
        isAllRequiredStepSatisfied(twoSlots, [{ approverUserId: 'staff-1' }], roles)
      ).toBe(false);
    });

    it('is true after staff and provider (distinct users) approve', () => {
      expect(
        isAllRequiredStepSatisfied(
          twoSlots,
          [
            { approverUserId: 'staff-1' },
            { approverUserId: 'prov-1' }
          ],
          roles
        )
      ).toBe(true);
    });

    it('does not count the same user twice for two staff slots', () => {
      const twoStaffSlots = [
        { id: '1', approverRole: 'staff' },
        { id: '2', approverRole: 'staff' }
      ];
      expect(
        isAllRequiredStepSatisfied(twoStaffSlots, [{ approverUserId: 'staff-1' }], roles)
      ).toBe(false);
      expect(
        isAllRequiredStepSatisfied(
          twoStaffSlots,
          [
            { approverUserId: 'staff-1' },
            { approverUserId: 'staff-2' }
          ],
          roles
        )
      ).toBe(true);
    });

    it('sorts slots by id deterministically (provider before staff lexicographic id)', () => {
      const slots = [
        { id: 'z', approverRole: 'staff' },
        { id: 'a', approverRole: 'provider' }
      ];
      expect(
        isAllRequiredStepSatisfied(
          slots,
          [
            { approverUserId: 'staff-1' },
            { approverUserId: 'prov-1' }
          ],
          roles
        )
      ).toBe(true);
    });
  });
});
