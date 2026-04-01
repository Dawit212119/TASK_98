/**
 * Verifies that an ordered list of audit rows matches the expected hash chain (previous_hash → entry_hash).
 * Used for static integrity checks; full tamper evidence still relies on recomputing entry_hash from payload.
 */
export function auditEntriesFormValidChain(
  entries: Array<{ previousHash: string | null; entryHash: string }>
): boolean {
  for (let i = 0; i < entries.length; i += 1) {
    const expectedPrev = i === 0 ? null : entries[i - 1]!.entryHash;
    const actualPrev = entries[i]!.previousHash ?? null;
    if (actualPrev !== expectedPrev) {
      return false;
    }
  }
  return true;
}
