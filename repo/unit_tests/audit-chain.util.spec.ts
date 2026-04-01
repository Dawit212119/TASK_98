/**
 * Acceptance: audit tamper / integrity — chain sequencing must detect broken previous_hash linkage.
 */
import { auditEntriesFormValidChain } from '../src/modules/audit/audit-chain.util';

describe('audit-chain.util', () => {
  it('accepts a valid chain', () => {
    expect(
      auditEntriesFormValidChain([
        { previousHash: null, entryHash: 'aaa' },
        { previousHash: 'aaa', entryHash: 'bbb' },
        { previousHash: 'bbb', entryHash: 'ccc' }
      ])
    ).toBe(true);
  });

  it('rejects tampered / reordered chain', () => {
    expect(
      auditEntriesFormValidChain([
        { previousHash: null, entryHash: 'aaa' },
        { previousHash: 'wrong', entryHash: 'bbb' }
      ])
    ).toBe(false);
  });
});
