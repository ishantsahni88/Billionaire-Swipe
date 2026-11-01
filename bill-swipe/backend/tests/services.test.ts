/**
 * Unit tests for the Phase-1 service layer: redaction (Feature 1),
 * verification pipeline (Feature 2), anonymity (Feature 5), ops console
 * (Persona 3), auth/OTP security, partner mock, disputes (Flow 4),
 * dashboard (Feature 7) and analytics PII-stripping.
 */

import { describe, it, expect } from 'vitest';
import { detectPii, redactionComplete, type OcrWord } from '../src/services/redaction';
import { autoScreen, isDuplicate, decideReview, REVIEW_CHECKLIST, SECONDARY_DOC_THRESHOLD_CENTS, type BillSubmission } from '../src/services/verification';
import { generatePayerHandle, holderDisplayName, regionOnly, toPublicBillCard, stripDigits, ANONYMOUS_DONOR_LINE } from '../src/services/anonymity';
import { buildQueue, recordReview, shouldFlagHolder } from '../src/services/opsConsole';
import { createChallenge, verifyOtp, generateOtpCode, hashOtp, isOfAge, canPay, MAX_OTP_ATTEMPTS, OTP_TTL_MS, LOCKOUT_MS, type OtpChallenge } from '../src/services/auth';
import { MockPaymentPartner, MockKycProvider } from '../src/services/partnerMock';
import { addBusinessDays, openDispute, reversePayment, republishDeadline, retentionDueMs } from '../src/services/disputes';
import { buildDashboard, renderReceiptPdf } from '../src/services/dashboard';
import { AnalyticsTracker, hashId, amountBucket } from '../src/services/analytics';
import type { PaymentLedgerRow } from '../src/services/payments';

// ---------------------------------------------------------------- helpers ----

const word = (text: string, x = 0, y = 0): OcrWord => ({ text, box: { x, y, w: 60, h: 12 } });

const sub = (over: Partial<BillSubmission> & { id: string }): BillSubmission => ({
  billHash: `hash-${over.id}`,
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
} as BillSubmission);

const fullChecklist = Object.fromEntries(REVIEW_CHECKLIST.map((k) => [k, true])) as Record<(typeof REVIEW_CHECKLIST)[number], boolean>;

const ledgerRow = (over: Partial<PaymentLedgerRow> = {}): PaymentLedgerRow => ({
  id: crypto.randomUUID(),
  billId: 'bill-1',
  payerId: 'payer-1',
  amountCents: 10_000,
  feeCents: 99,
  partnerTxnId: 'txn-1',
  status: 'confirmed',
  createdAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

// ------------------------------------------------------- Feature 1 ----------

describe('redaction — Feature 1', () => {
  it('detects an 8+ digit account number in OCR words', () => {
    const regions = detectPii([word('Account'), word('1234'), word('5678'), word('9012')]);
    expect(regions.some((r) => r.kind === 'account_number')).toBe(true);
  });

  it('detects barcodes with full confidence', () => {
    const regions = detectPii([word('...')], [{ box: { x: 10, y: 300, w: 200, h: 40 } }]);
    expect(regions).toContainEqual({ kind: 'barcode', box: { x: 10, y: 300, w: 200, h: 40 }, confidence: 1 });
  });

  it('fail-closed publish gate: incomplete redaction blocks publishing', () => {
    const detected = detectPii([word('Acct'), word('12345678')]);
    expect(redactionComplete(detected, [])).toBe(false); // nothing applied -> cannot publish
    expect(redactionComplete(detected, detected)).toBe(true);
  });
});

// ------------------------------------------------------- Feature 2 ----------

describe('verification pipeline — Feature 2', () => {
  it('duplicate detection catches exact re-uploads 100% of the time', () => {
    const a = sub({ id: 'a' });
    const b = sub({ id: 'b', billHash: a.billHash });
    expect(isDuplicate(b, [a])).toBe(true);
  });

  it('duplicate fingerprint = biller + amount + date even with different image hash', () => {
    const a = sub({ id: 'a' });
    const b = sub({ id: 'b', billHash: 'totally-different', ocr: { ...a.ocr, accountHolderInitials: 'X.Y' } });
    expect(isDuplicate(b, [a])).toBe(true);
  });

  it('auto-screen flags non-allowlisted billers, paid stamps, amount mismatch, initials mismatch', () => {
    const s = sub({
      id: 'x',
      ocr: { billerName: 'Sketchy Power Co', amountCents: 30_000, dueDate: '2026-12-01', accountHolderInitials: 'A.B', hasPaidStamp: true },
      declaredAmountCents: 24_000,
      holderInitials: 'JMK',
    });
    const screen = autoScreen(s, []);
    expect(screen.flags).toEqual(
      expect.arrayContaining(['biller_not_allowlisted', 'paid_stamp_visible', 'amount_mismatch', 'holder_initials_mismatch']),
    );
  });

  it('secondary doc required over $500; approve only when checklist complete', () => {
    expect(SECONDARY_DOC_THRESHOLD_CENTS).toBe(50_000);
    const big = sub({ id: 'big', declaredAmountCents: 50_001, ocr: { ...sub({ id: 't' }).ocr, amountCents: 50_001 } });
    expect(autoScreen(big, []).requiresSecondaryDoc).toBe(true);
    expect(decideReview({ checklist: fullChecklist, secondaryDocProvided: false, amountCents: 50_001, hardFlags: [] })).toBe('request_more');
    expect(decideReview({ checklist: fullChecklist, secondaryDocProvided: true, amountCents: 50_001, hardFlags: [] })).toBe('approve');
  });

  it('hard flags force reject regardless of checklist', () => {
    expect(decideReview({ checklist: fullChecklist, secondaryDocProvided: true, amountCents: 100, hardFlags: ['possible_duplicate'] })).toBe('reject');
    expect(decideReview({ checklist: fullChecklist, secondaryDocProvided: true, amountCents: 100, hardFlags: ['paid_stamp_visible'] })).toBe('reject');
  });
});

// ------------------------------------------------------- Feature 5 ----------

describe('anonymity — Feature 5', () => {
  it('payer handles are deterministic and never contain user input identity', () => {
    const h1 = generatePayerHandle('user-1', 'salt');
    expect(h1).toBe(generatePayerHandle('user-1', 'salt'));
    expect(h1.startsWith('Anonymous ')).toBe(true);
  });

  it('holder display shows first name + last initial only', () => {
    expect(holderDisplayName('Maya', 'Kowalski')).toBe('Maya K.');
  });

  it('regionOnly strips street and postal code', () => {
    expect(regionOnly('123 Queen St, Toronto, ON M5V 2T6')).toBe('Toronto');
  });

  it('toPublicBillCard is fail-closed: unknown keys dropped, originals blocked, long digit runs scrubbed', () => {
    const card = toPublicBillCard<{ [k: string]: unknown }>({
      id: 'b1',
      category: 'utility',
      amountCents: 24_050,
      holder_id: 'SECRET-HOLDER-UUID',
      biller_name: 'Toronto Hydro',
      original_image_key: 's3/originals/secret.jpg',
      redactedImageUrl: 'https://cdn/redacted/b1.jpg',
      story: 'My account 123456789 was cut off.',
      region: 'Toronto',
    });
    expect(card.holder_id).toBeUndefined();
    expect(card.biller_name).toBeUndefined();
    expect(card.original_image_key).toBeUndefined();
    expect(String(card.story)).not.toContain('123456789');
    expect(card.redactedImageUrl).toContain('redacted');
    // an original URL masquerading as redacted is dropped entirely
    const bad = toPublicBillCard<{ redactedImageUrl?: string }>({ id: 'b2', redactedImageUrl: 'https://cdn/originals/b2.jpg' });
    expect(bad.redactedImageUrl).toBeUndefined();
  });

  it('stripDigits removes account-shaped runs but keeps small numbers', () => {
    expect(stripDigits('owe 1234-5678-90 today')).toContain('[redacted]');
    expect(stripDigits('due in 5 days')).toBe('due in 5 days');
  });

  it('the donor line is generic', () => {
    expect(ANONYMOUS_DONOR_LINE).toBe('an anonymous donor');
  });
});

// --------------------------------------------------- Persona 3 / Ops --------

describe('ops console', () => {
  it('queue is oldest-first so the 24h SLA is protected, and marks breaches', () => {
    const now = Date.now();
    const q = buildQueue(
      [
        { sub: sub({ id: 'new' }), submittedAt: now - 3_600_000, dueDateMs: now },
        { sub: sub({ id: 'old' }), submittedAt: now - 25 * 3_600_000, dueDateMs: now },
      ],
      [],
      now,
    );
    expect(q.map((i) => i.billId)).toEqual(['old', 'new']);
    expect(q[0].slaBreached).toBe(true);
    expect(q[1].slaBreached).toBe(false);
  });

  it('recordReview refuses an approve path on an incomplete checklist', () => {
    expect(() =>
      recordReview({ billId: 'b', reviewerId: 'r', checklist: { biller_legitimate: true } as never, secondaryDocProvided: false, amountCents: 100, hardFlags: [] }),
    ).toThrow(/incomplete checklist/);
  });

  it('holder flagged after two rejected submissions', () => {
    expect(shouldFlagHolder(['reject', 'request_more'])).toBe(false);
    expect(shouldFlagHolder(['reject', 'reject'])).toBe(true);
  });
});

// ------------------------------------------------------------- Auth ---------

describe('auth — OTP, lockout, age, KYC', () => {
  it('valid code consumes the challenge; replays are rejected', () => {
    const now = 1_000;
    const code = generateOtpCode();
    let ch = createChallenge('+14165551234', 'phone', code, 'salt', now);
    let r = verifyOtp(ch, code, 'salt', now + 1000);
    expect(r.outcome.ok).toBe(true);
    r = verifyOtp(r.next, code, 'salt', now + 2000);
    expect(r.outcome).toEqual({ ok: false, reason: 'already_used' });
  });

  it('locks out after MAX_OTP_ATTEMPTS wrong codes and honours the lock window', () => {
    const now = 0;
    // challenge valid until now + ttl so only the LOCKOUT (not expiry) is under test
    const ttl = OTP_TTL_MS + LOCKOUT_MS + 10_000;
    const ch: OtpChallenge = { ...createChallenge('a@b.ca', 'email', '123456', 'salt', now), expiresAt: now + ttl };
    let cur = ch;
    for (let i = 0; i < MAX_OTP_ATTEMPTS - 1; i++) {
      cur = verifyOtp(cur, '000000', 'salt', now + 1000).next; // still 'mismatch'
    }
    const last = verifyOtp(cur, '000000', 'salt', now + 1000);
    expect(last.outcome).toEqual({ ok: false, reason: 'locked' });
    cur = last.next;
    // even the RIGHT code fails while locked
    const whileLocked = verifyOtp(cur, '123456', 'salt', now + 1000);
    expect(whileLocked.outcome).toEqual({ ok: false, reason: 'locked' });
    // after LOCKOUT_MS expires the correct code works again
    const unlocked = verifyOtp(cur, '123456', 'salt', now + 1000 + LOCKOUT_MS + 1);
    expect(unlocked.outcome.ok).toBe(true);
  });

  it('expired codes are rejected', () => {
    const ch = createChallenge('x', 'phone', '123456', 'salt', 0);
    expect(verifyOtp(ch, '123456', 'salt', OTP_TTL_MS + 1).outcome).toEqual({ ok: false, reason: 'expired' });
  });

  it('codes are stored hashed, never plaintext', () => {
    const ch = createChallenge('x', 'phone', '123456', 'salt', 0);
    expect(ch.codeHash).toBe(hashOtp('123456', 'salt'));
    expect(ch.codeHash).not.toContain('123456');
  });

  it('18+ gate at sign-up', () => {
    const now = Date.parse('2026-11-01');
    expect(isOfAge('2000-05-01', now)).toBe(true);
    expect(isOfAge('2010-05-01', now)).toBe(false);
    expect(isOfAge('garbage', now)).toBe(false);
  });

  it('only approved KYC payers can pay', () => {
    expect(canPay('approved')).toBe(true);
    for (const s of ['not_started', 'pending', 'rejected'] as const) expect(canPay(s)).toBe(false);
  });

  it('sanctions screening rejects listed subjects', async () => {
    const kyc = new MockKycProvider(new Set(['bad-actor']));
    await expect(kyc.screen('bad-actor')).resolves.toBe('rejected');
    await expect(kyc.screen('good')).resolves.toBe('approved');
  });
});

// ------------------------------------------------------ Partner mock --------

describe('mock licensed partner', () => {
  it('authorize takes NO card data — signature has no PAN field', () => {
    expect(MockPaymentPartner.prototype.authorize.length).toBe(2); // (payerId, amountCents)
  });

  it('declined payer yields ok:false; biller refusal throws', async () => {
    const p = new MockPaymentPartner({ declinedPayers: new Set(['poor-card']), rejectingBillers: new Set(['grumpy-biller']) });
    expect((await p.authorize('poor-card', 100)).ok).toBe(false);
    const good = await p.authorize('good', 100);
    await expect(p.sendToBiller(good.txnId, 'grumpy-biller', 100)).rejects.toThrow(/refused/);
  });

  it('manual pilot fallback: enqueue then ops completes, money still bypasses us', async () => {
    const p = new MockPaymentPartner();
    const { txnId } = await p.authorize('payer-1', 5000);
    p.enqueueManual(txnId, 'toronto-hydro', 5000);
    expect(p.manualQueue).toHaveLength(1);
    const conf = p.completeManual(txnId);
    expect(conf.confirmation).toBe(`CONF-MANUAL-${txnId}`);
    expect(p.manualQueue).toHaveLength(0);
    expect(p.sentToBiller).toHaveLength(1);
  });
});

// ------------------------------------------------------ Disputes F4 ---------

describe('disputes — Flow 4', () => {
  it('business-day deadline skips weekends', () => {
    // Friday 2026-10-30 + 2 business days -> Tuesday 2026-11-03
    const fri = Date.parse('2026-10-30T12:00:00Z');
    expect(new Date(addBusinessDays(fri, 2)).toISOString().slice(0, 10)).toBe('2026-11-03');
  });

  it('openDispute defaults to state=open with a 2-business-day due date', () => {
    const d = openDispute({ id: 'd1', billId: 'b1', reporterRole: 'payer', type: 'scam', openedAt: Date.parse('2026-11-02T12:00:00Z') });
    expect(d.state).toBe('open');
    expect(new Date(d.dueBy).getUTCDay()).not.toBe(0);
    expect(new Date(d.dueBy).getUTCDay()).not.toBe(6);
  });

  it('reversePayment enforces the state machine and calls the partner refund', async () => {
    const refunds: string[] = [];
    const row = ledgerRow({ status: 'captured' });
    const out = await reversePayment({
      payment: row,
      to: 'reversed',
      partnerRefund: async (t) => void refunds.push(t),
      persist: async () => {},
      allowConfirmedRefund: false,
    });
    expect(out.status).toBe('reversed');
    expect(refunds).toEqual(['txn-1']);
    // authorized -> reversed is NOT legal
    await expect(
      reversePayment({ payment: ledgerRow({ status: 'authorized' }), to: 'reversed', partnerRefund: async () => {}, persist: async () => {}, allowConfirmedRefund: false }),
    ).rejects.toThrow(/illegal payment transition/);
    // confirmed -> reversed requires the explicit partner-capability flag
    await expect(
      reversePayment({ payment: ledgerRow({ status: 'confirmed' }), to: 'reversed', partnerRefund: async () => {}, persist: async () => {}, allowConfirmedRefund: false }),
    ).rejects.toThrow(/illegal/);
    const ok = await reversePayment({ payment: ledgerRow({ status: 'confirmed' }), to: 'reversed', partnerRefund: async () => {}, persist: async () => {}, allowConfirmedRefund: true });
    expect(ok.status).toBe('reversed');
  });

  it('republished within 1 hour of reversal (Feature 4 AC)', () => {
    expect(republishDeadline(0)).toBe(3_600_000);
  });

  it('retention: 90-day deletion clock pauses while a dispute is open', () => {
    const paid = Date.parse('2026-01-01T00:00:00Z');
    expect(retentionDueMs(paid, false)).toBe(paid + 90 * 86_400_000);
    expect(retentionDueMs(paid, true)).toBeNull();
  });
});

// ---------------------------------------------------- Dashboard F7 ----------

describe('payer dashboard — Feature 7', () => {
  it('counts only money that reached a biller', () => {
    const rows = [
      ledgerRow({ status: 'confirmed', amountCents: 10_000, feeCents: 99 }),
      ledgerRow({ status: 'sent_to_biller', billId: 'bill-2', amountCents: 5_000, feeCents: 99 }),
      ledgerRow({ status: 'failed', amountCents: 99_999 }),
      ledgerRow({ status: 'authorized', amountCents: 88_888 }),
      ledgerRow({ status: 'reversed', amountCents: 77_777 }),
    ];
    const s = buildDashboard(rows, (id) => (id === 'bill-2' ? 'medical' : 'utility'));
    expect(s.totalFundedCents).toBe(15_000);
    expect(s.totalFeesCents).toBe(198);
    expect(s.billsFunded).toBe(2);
    expect(s.categories).toEqual({ utility: 1, medical: 1 });
  });

  it('receipt PDF is well-formed and contains the confirmation, not card data', () => {
    const pdf = Buffer.from(
      renderReceiptPdf({ payerHandle: 'Anonymous quiet-river 101', billerLabel: 'Utility bill', amountCents: 24_050, feeCents: 99, totalCents: 24_149, confirmationNumber: 'CONF-1', paidAt: '2026-11-01' }),
    ).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('%%EOF');
    expect(pdf).toContain('CONF-1');
    expect(pdf).toContain('$240.50');
    expect(pdf).toContain('did not hold these funds');
    expect(pdf).toContain('Not a tax receipt');
  });
});

// ----------------------------------------------------- Analytics ------------

describe('analytics — PII stripped at ingestion', () => {
  it('raw ids are replaced by salted hashes; amounts bucketed outside ledger events', () => {
    const events: { name: string; props: Record<string, unknown> }[] = [];
    const t = new AnalyticsTracker({ ingest: (e) => events.push(e) }, 'pepper');
    t.track('bill_uploaded', 'holder-uuid', { holder_id: 'holder-uuid', amountCents: 24_050 });
    const e = events[0];
    expect(e.props.holder_id).toBeUndefined();
    expect(e.props.hashed_holder_id).toBe(hashId('holder-uuid', 'pepper'));
    expect(e.props.amountCents).toBeUndefined();
    expect(e.props.amount_bucket).toBe(amountBucket(24_050));
    // ledger-sourced events may keep exact cents
    t.track('payment_completed', 'payer-1', { amountCents: 24_050 });
    expect(events[1].props.amountCents).toBe(24_050);
  });
});
