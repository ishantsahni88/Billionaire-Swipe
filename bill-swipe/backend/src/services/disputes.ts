/**
 * Dispute & reversal service — PRD User Flow 4 + Feature 4 AC
 * ("Failed payments are reversed and the bill is republished within 1 hour").
 *
 * Rules encoded here:
 *   - a report pauses the bill IMMEDIATELY (Content & Fraud Controls)
 *   - ops resolves within 2 business days
 *   - outcomes: refund to payer | bill republished | account action
 *   - refunds only ever go back through the licensed partner (we hold no funds)
 *   - data retention: originals deleted 90 days after paid/withdrawn UNLESS a
 *     dispute is open (Privacy Measures) — modeled by retentionDueMs().
 */

import type { PaymentStatus } from '@bill-swipe/shared';
import { canTransition, type PaymentLedgerRow } from './payments.js';

export type DisputeType = 'wrong_biller' | 'bill_already_paid' | 'scam' | 'charged_wrong_amount' | 'other';
export type DisputeState = 'open' | 'under_review' | 'resolved_refund' | 'resolved_republish' | 'resolved_account_action';

export interface Dispute {
  id: string;
  paymentId?: string;
  billId: string;
  reporterRole: 'payer' | 'holder';
  type: DisputeType;
  state: DisputeState;
  openedAt: number; // epoch ms
  dueBy: number; // 2 business days out
}

/** Business-day deadline: skip weekends. Ops SLA per Flow 4 step 3. */
export function addBusinessDays(fromMs: number, days: number): number {
  let t = fromMs;
  let added = 0;
  while (added < days) {
    t += 86_400_000;
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return t;
}

export function openDispute(opts: Omit<Dispute, 'state' | 'dueBy'> & { state?: DisputeState }): Dispute {
  return { ...opts, state: opts.state ?? 'open', dueBy: addBusinessDays(opts.openedAt, 2) };
}

export interface RefundResult {
  payment: PaymentLedgerRow;
  /** cents returned to payer's card via the partner — never from a Bill Swipe balance */
  refundedCents: number;
  billRepublished: boolean;
}

/**
 * Reverse a payment: legal transitions enforced (authorized->... etc.).
 * A confirmed payment CAN be refunded through the partner's dispute/refund API;
 * that path is `confirmed -> reversed` which our machine allows ONLY when the
 * partner supports it. Default machine marks confirmed as terminal, so this
 * function requires an explicit partnerRefund capability flag — mirroring the
 * real-world constraint that we can't claw money back from a biller at will.
 */
export async function reversePayment(opts: {
  payment: PaymentLedgerRow;
  to: PaymentStatus;
  partnerRefund: (txnId: string) => Promise<void>;
  persist: (row: PaymentLedgerRow) => Promise<void>;
  allowConfirmedRefund: boolean;
}): Promise<PaymentLedgerRow> {
  const { payment } = opts;
  const legal = canTransition(payment.status, opts.to) || (opts.allowConfirmedRefund && payment.status === 'confirmed' && opts.to === 'reversed');
  if (!legal) throw new Error(`illegal payment transition ${payment.status} -> ${opts.to}`);
  if (opts.to === 'reversed') await opts.partnerRefund(payment.partnerTxnId!);
  payment.status = opts.to;
  await opts.persist(payment);
  return payment;
}

/**
 * After reversal the bill must re-enter the feed within 1 hour (Feature 4 AC).
 * Returns the deadline for the republish job.
 */
export function republishDeadline(reversedAtMs: number): number {
  return reversedAtMs + 60 * 60_000;
}

/**
 * Privacy retention rule: original bill images are deleted 90 days after the
 * bill is paid or withdrawn — unless a dispute is open, in which case the
 * clock pauses until the dispute closes (legal-hold semantics).
 */
export function retentionDueMs(closedEventMs: number, openDispute: boolean): number | null {
  if (openDispute) return null; // hold
  return closedEventMs + 90 * 86_400_000;
}
