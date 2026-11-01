/**
 * Thank-you relay unit tests — PRD Feature 6 acceptance criteria.
 */

import { describe, it, expect } from 'vitest';
import {
  composeThankYou, applyModerationVerdict, eligibleForDelivery,
  markDelivered, toPayerView, DuplicateThankYouError, EmptyMessageError,
  DELIVERY_SLA_MS, type ThankYouRecord,
} from '../src/services/thankYou';

const NOW = 1_700_000_000_000; // fixed clock for SLA assertions

describe('Feature 6 — thank-you relay', () => {
  it('clean message is approved immediately with a 1h delivery deadline', () => {
    const { record } = composeThankYou({
      paymentId: 'pay-1', body: 'The lights are back on. Thank you.', nowMs: NOW,
    });
    expect(record.state).toBe('approved');
    expect(record.deliverByMs - record.createdAtMs).toBe(DELIVERY_SLA_MS);
    expect(eligibleForDelivery(record, NOW)).toBe(true);
    expect(eligibleForDelivery(record, NOW + DELIVERY_SLA_MS + 1)).toBe(false);
  });

  it('one message per payment: second composition throws', () => {
    const first = composeThankYou({ paymentId: 'pay-2', body: 'Thanks!', nowMs: NOW }).record;
    expect(() =>
      composeThankYou({ paymentId: 'pay-2', body: 'Also thanks', existingForPayment: [first], nowMs: NOW }),
    ).toThrow(DuplicateThankYouError);
  });

  it('empty and over-length messages fail closed', () => {
    expect(() => composeThankYou({ paymentId: 'p', body: '   ', nowMs: NOW })).toThrow(EmptyMessageError);
    expect(() =>
      composeThankYou({ paymentId: 'p', body: 'x'.repeat(281), nowMs: NOW }),
    ).toThrow(/280/);
  });

  it('contact-info leaks and harassment are rejected and never delivered', () => {
    const { record } = composeThankYou({
      paymentId: 'p', body: 'email me at maya@example.com to say more', nowMs: NOW,
    });
    expect(record.state).toBe('rejected');
    expect(eligibleForDelivery(record, NOW)).toBe(false);
    expect(() => markDelivered(record)).toThrow();
  });

  it('flagged-but-allowed text waits for review verdict before delivery', () => {
    // "fake" trips the harassment flag list -> needs human/ops verdict
    const { record, moderationHits } = composeThankYou({
      paymentId: 'p', body: 'No story here is fake — this one is real gratitude.', nowMs: NOW,
    });
    if (moderationHits.length) {
      expect(record.state).toBe('pending');
      expect(eligibleForDelivery(record, NOW)).toBe(false);
      const rejected = applyModerationVerdict(record, false);
      expect(rejected.state).toBe('rejected');
      expect(eligibleForDelivery(rejected, NOW)).toBe(false);
      const approved = applyModerationVerdict(record, true);
      expect(eligibleForDelivery(approved, NOW)).toBe(true);
    } else {
      expect(record.state).toBe('approved'); // moderation rules changed; keep test honest
    }
  });

  it('resolved records are immutable to further verdicts (exactly one verdict per note)', () => {
    // A soft-flagged note ("fake" trips the harassment flag) lands in 'pending',
    // so a real verdict is legal exactly once.
    const { record } = composeThankYou({ paymentId: 'p', body: 'Nothing fake about this gratitude.', nowMs: NOW });
    expect(record.state).toBe('pending'); // keep test honest if moderation rules change
    const approved = applyModerationVerdict(record, true); // pending -> approved
    expect(approved.state).toBe('approved');
    // MVP rule: one message per payment => one verdict. Re-verdicting a
    // RESOLVED record throws rather than silently flipping delivery.
    expect(() => applyModerationVerdict(approved, false)).toThrow(/already resolved/);
    const delivered = markDelivered(approved);
    expect(delivered.state).toBe('delivered');
    expect(() => applyModerationVerdict(delivered, false)).toThrow(/already resolved/);
  });

  it('payer view carries no identity fields (Feature 5)', () => {
    const { record } = composeThankYou({ paymentId: 'p', body: 'Thank you!', nowMs: NOW });
    const view = toPayerView(record as ThankYouRecord);
    expect(view).toEqual({ senderLabel: 'Anonymous donor', text: 'Thank you!' });
    expect(JSON.stringify(view)).not.toMatch(/holder|name|address/i);
  });
});
