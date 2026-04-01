/**
 * Deterministic completion rules for workflow steps (see README — Workflow approval modes).
 *
 * A "step group" is all workflow_steps rows with the same `order` that match the request payload conditions.
 * - ANY_ONE: one valid approval from any eligible approver completes the group.
 * - ALL_REQUIRED: each slot in the group (each row, stable-sorted by id) must be satisfied by a distinct
 *   approver user. An approver satisfies a slot if they have that slot's approver_role or ops_admin.
 */

export type WorkflowSlot = { id: string; approverRole: string };

export type WorkflowApprovalRow = { approverUserId: string };

export function isAnyOneStepSatisfied(
  slots: WorkflowSlot[],
  approvals: WorkflowApprovalRow[],
  rolesByUserId: Record<string, string[]>
): boolean {
  if (slots.length === 0 || approvals.length === 0) {
    return false;
  }

  return approvals.some((a) => approverCanSatisfyAnySlot(a.approverUserId, slots, rolesByUserId));
}

export function isAllRequiredStepSatisfied(
  slots: WorkflowSlot[],
  approvals: WorkflowApprovalRow[],
  rolesByUserId: Record<string, string[]>
): boolean {
  if (slots.length === 0) {
    return false;
  }

  const sortedSlots = [...slots].sort((a, b) => a.id.localeCompare(b.id));
  const usedApproverIds = new Set<string>();

  for (const slot of sortedSlots) {
    const match = approvals.find(
      (row) =>
        !usedApproverIds.has(row.approverUserId) && approverSatisfiesSlot(row.approverUserId, slot, rolesByUserId)
    );
    if (!match) {
      return false;
    }
    usedApproverIds.add(match.approverUserId);
  }

  return true;
}

function approverCanSatisfyAnySlot(userId: string, slots: WorkflowSlot[], rolesByUserId: Record<string, string[]>): boolean {
  return slots.some((slot) => approverSatisfiesSlot(userId, slot, rolesByUserId));
}

function approverSatisfiesSlot(userId: string, slot: WorkflowSlot, rolesByUserId: Record<string, string[]>): boolean {
  const roles = rolesByUserId[userId] ?? [];
  const requiredRole = slot.approverRole.toLowerCase();
  return roles.includes('ops_admin') || roles.includes(requiredRole);
}
