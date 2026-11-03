/**
 * Mock licensed payment partner — stands in for the real bill-payment partner
 * (PRD Dependencies: agreement + onboarding is a gating item, 4–8 weeks).
 *
 * Two things this file proves in code:
 *   1. Bill Swipe never sees or stores card data: authorize() takes only a
 *      payer reference and an amount; there is no PAN field anywhere.
 *   2. The manual-biller fallback from the PRD ("pilot may need manual biller
 *      payment at first") is modelled as a queue a human ops member drains —
 *      money still moves payer -> partner -> biller, never through us.
 */

import type { PartnerGateway } from './payments.js';

export interface MockPartnerOptions {
  /** simulate declines by payer ref (deterministic tests) */
  declinedPayers?: Set<string>;
  /** simulate billers that reject inbound payments */
  rejectingBillers?: Set<string>;
}

export class MockPaymentPartner implements PartnerGateway {
  readonly authorizations: { txnId: string; payerId: string; amountCents: number }[] = [];
  readonly sentToBiller: { txnId: string; billerRef: string; amountCents: number }[] = [];
  readonly refunds: string[] = [];
  /** manual pilot path: payments waiting for an ops human to pay the biller */
  readonly manualQueue: { txnId: string; billerRef: string; amountCents: number }[] = [];

  private seq = 0;

  constructor(private opts: MockPartnerOptions = {}) {}

  async authorize(payerId: string, amountCents: number) {
    const txnId = `mock_txn_${++this.seq}`;
    this.authorizations.push({ txnId, payerId, amountCents });
    const ok = !this.opts.declinedPayers?.has(payerId);
    return { txnId, ok };
  }

  async sendToBiller(txnId: string, billerRef: string, amountCents: number) {
    if (this.opts.rejectingBillers?.has(billerRef)) {
      throw new Error(`biller refused payment for ${billerRef}`);
    }
    this.sentToBiller.push({ txnId, billerRef, amountCents });
    return { confirmation: `CONF-${txnId}` };
  }

  async refund(txnId: string) {
    this.refunds.push(txnId);
  }

  /** Pilot fallback: park the transfer for manual execution by ops. */
  enqueueManual(txnId: string, billerRef: string, amountCents: number) {
    this.manualQueue.push({ txnId, billerRef, amountCents });
  }

  /** Ops drains the manual queue; returns the confirmation like the API path. */
  completeManual(txnId: string): { confirmation: string } {
    const idx = this.manualQueue.findIndex((m) => m.txnId === txnId);
    if (idx === -1) throw new Error('not in manual queue');
    const [item] = this.manualQueue.splice(idx, 1);
    this.sentToBiller.push(item);
    return { confirmation: `CONF-MANUAL-${item.txnId}` };
  }
}

/**
 * Sanctions / KYC provider stub (PRD: "identity and sanctions screening").
 * Real impl calls the partner's KYC vendor; here it's a deterministic list so
 * the route-level gate (kyc !== approved -> 403 FORBIDDEN) can be tested.
 */
export class MockKycProvider {
  constructor(private sanctionedSubjects: Set<string> = new Set()) {}
  async screen(userId: string): Promise<'approved' | 'pending' | 'rejected'> {
    if (this.sanctionedSubjects.has(userId)) return 'rejected';
    return 'approved';
  }
}
