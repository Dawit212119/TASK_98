/**
 * True if the workflow request SLA deadline is strictly before `now` (business or clock SLA already baked into deadline_at).
 */
export function isWorkflowDeadlinePassed(deadlineAt: Date, now: Date = new Date()): boolean {
  return now.getTime() > deadlineAt.getTime();
}
