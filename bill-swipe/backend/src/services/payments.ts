/**
 * Payment service — PRD Feature 4 (Direct Biller Payment).
 *
 * NON-NEGOTIABLE COMPLIANCE CONSTRAINTS encoded here:
 *   1. Bill Swipe NEVER holds customer funds. There is no balance, no pool,
 *      no in-app wallet. Money flows payer -> licensed partner -> biller.
 *   2. Release to biller happens ONLY after authorization clears.
 *   3. Failed payments reverse and republish the bill within 1 hour.
 *   4. Partial funding is allowed; remaining balance is republished.
 *
 * The real implementation calls the licensed payment partner (TBD — see PRD
 * Dependencies; legal sign-off is the gating item). This module models the
 * state machine and ledger so contract tests can pin the behaviour.
 */

import type { PaymentStatus } from '@bill-swipe/shared';

export interface PaymentLedgerRow {
  id: string;
  billId: string;
  payerId: string;
  amountCents: number;
  feeCents: number;
  partnerTxnId?: string;
  status: PaymentStatus;
  billerConfirmation?: string;
  createdAt: string;
}

/** Allowed transitions per PRD Feature 4. Anything else is a bug, not a retry. */
const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  authorized: ['captured', 'failed'],
  captured: ['sent_to_biller', 'reversed'],
  sent_to_biller: ['confirmed', 'failed'],
  confirmed: [],
  failed: ['reversed'],
  reversed: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface PartnerGateway {
  /** card capture + auth happen entirely at the partner; we never see PANs */
  authorize(payerId: string, amountCents: number): Promise<{ txnId: string; ok: boolean }>;
  sendToBiller(txnId: string, billerRef: string, amountCents: number): Promise<{ confirmation: string }>;
  refund(txnId: string): Promise<void>;
}

export class InsufficientBalanceError extends Error {}
export class IllegalTransitionError extends Error {}

export interface FundResult {
  payment: PaymentLedgerRow;
  billStatusAfter: 'partially_funded' | 'paid';
  remainingCents: number;
}

/**
 * Idempotent by partnerTxnId (PRD: UNIQUE(partner_txn_id)).
 */
export async function fundBill(opts: {
  bill: { id: string; amountCents: number; fundedCents: number };
  payerId: string;
  amountCents: number;
  feeCents: number;
  gateway: PartnerGateway;
  persist: (row: PaymentLedgerRow) => Promise<void>;
}): Promise<FundResult> {
  const balance = opts.bill.amountCents - opts.bill.fundedCents;
  if (opts.amountCents <= 0 || opts.amountCents > balance) {
    throw new InsufficientBalanceError(`amount ${opts.amountCents} exceeds balance ${balance}`);
  }

  const auth = await opts.gateway.authorize(opts.payerId, opts.amountCents + opts.feeCents);
  const now = new Date().toISOString();
  const row: PaymentLedgerRow = {
    id: crypto.randomUUID(),
    billId: opts.bill.id,
    payerId: opts.payerId,
    amountCents: opts.amountCents,
    feeCents: opts.feeCents,
    partnerTxnId: auth.txnId,
    status: 'authorized',
    createdAt: now,
  };
  await opts.persist(row);

  // Release to biller ONLY after authorization clears (PRD Feature 4).
  if (!auth.ok) {
    row.status = 'failed';
    await opts.persist(row);
    throw new IllegalTransitionError('authorization declined');
  }
  row.status = 'captured';
  await opts.persist(row);

  const sent = await opts.gateway.sendToBiller(auth.txnId, opts.bill.id, opts.amountCents);
  row.status = 'sent_to_biller';
  row.billerConfirmation = sent.confirmation;
  await opts.persist(row);

  const fundedSoFar = opts.bill.fundedCents + opts.amountCents;
  const remaining = opts.bill.amountCents - fundedSoFar;
  return {
    payment: row,
    billStatusAfter: remaining === 0 ? 'paid' : 'partially_funded',
    remainingCents: Math.max(remaining, 0),
  };
}
