import { describe, it, expect } from 'vitest';
import {
  autoScreen,
  decideReview,
  isDuplicate,
  SECONDARY_DOC_THRESHOLD_CENTS,
  REVIEW_CHECKLIST,
  type BillSubmission,
} from '../src/services/verification';

const sub = (over: Partial<BillSubmission> = {}): BillSubmission => ({
  id: 'b1',
  billHash: 'hash-aaa',
  ocr: {
    billerName: 'Toronto Hydro',
    amountCents: 24_050,
    dueDate: '2026-11-20',
    accountHolderInitials: 'J.M.K',
    hasPaidStamp: false,
  },
  declaredAmountCents: 24_050,
  holderInitials: 'JMK',
  hasSecondaryDocument: false,
  ...over,
});

describe('Feature 2 — duplicate detection', () => {
  it('catches exact re-uploads 100% of the time (AC)', () => {
    const prior = [sub()];
    expect(isDuplicate(sub({ id: 'b2', billHash: 'hash-aaa' }), prior)).toBe(true);
  });

  it('catches same biller + amount + date with a different image hash', () => {
    const prior = [sub()];
    const other = sub({ id: 'b3', billHash: 'hash-bbb', ocr: { ...sub().ocr, billerName: 'toronto hydro ' } });
    expect(isDuplicate(other, prior)).toBe(true);
  });

  it('does not flag a genuinely different bill', () => {
    const prior = [sub()];
    const fresh = sub({
      id: 'b4',
      billHash: 'hash-ccc',
      ocr: { ...sub().ocr, amountCents: 9_900, dueDate: '2026-12-01' },
    });
    expect(isDuplicate(fresh, prior)).toBe(false);
  });
});

describe('Feature 2 — automated pre-screening', () => {
  it('flags billers not on the allowlist', () => {
    const s = sub({ ocr: { ...sub().ocr, billerName: 'Sketchy Power Co' } });
    expect(autoScreen(s, []).flags).toContain('biller_not_allowlisted');
  });

  it('flags a visible PAID stamp', () => {
    const s = sub({ ocr: { ...sub().ocr, hasPaidStamp: true } });
    expect(autoScreen(s, []).flags).toContain('paid_stamp_visible');
  });

  it('requires a secondary document over $500 (PRD threshold)', () => {
    expect(SECONDARY_DOC_THRESHOLD_CENTS).toBe(50_000);
    const big = sub({ declaredAmountCents: 50_100, ocr: { ...sub().ocr, amountCents: 50_100 } });
    expect(autoScreen(big, []).requiresSecondaryDoc).toBe(true);
    const small = sub();
    expect(autoScreen(small, []).requiresSecondaryDoc).toBe(false);
  });
});

describe('Feature 2 — reviewer decision logic', () => {
  const okChecklist = Object.fromEntries(REVIEW_CHECKLIST.map((k) => [k, true])) as Record<(typeof REVIEW_CHECKLIST)[number], boolean>;

  it('approves when checklist complete and no hard flags', () => {
    expect(decideReview({ checklist: okChecklist, secondaryDocProvided: false, amountCents: 24_050, hardFlags: [] })).toBe('approve');
  });

  it('requests more info when a >$500 bill lacks the secondary document', () => {
    expect(
      decideReview({ checklist: okChecklist, secondaryDocProvided: false, amountCents: 60_000, hardFlags: [] }),
    ).toBe('request_more');
  });

  it('rejects duplicates and paid-stamp bills outright', () => {
    expect(decideReview({ checklist: okChecklist, secondaryDocProvided: true, amountCents: 60_000, hardFlags: ['possible_duplicate'] })).toBe('reject');
    expect(decideReview({ checklist: okChecklist, secondaryDocProvided: true, amountCents: 60_000, hardFlags: ['paid_stamp_visible'] })).toBe('reject');
  });

  it('never approves with an incomplete checklist', () => {
    const partial = { ...okChecklist, no_paid_stamp: false };
    expect(decideReview({ checklist: partial, secondaryDocProvided: true, amountCents: 60_000, hardFlags: [] })).toBe('request_more');
  });
});
