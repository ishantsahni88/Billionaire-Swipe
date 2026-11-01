import { describe, it, expect } from 'vitest';
import {
  fundBill,
  canTransition,
  InsufficientBalanceError,
  type PartnerGateway,
  type PaymentLedgerRow,
} from '../src/services/payments';

const okGateway = (authOk = true): PartnerGateway & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    async authorize() { calls.push('authorize'); return { txnId: 'txn_1', ok: authOk }; },
    async sendToBiller() { calls.push('send_to_biller'); return { confirmation: 'BILLER-98765' }; },
    async refund() { calls.push('refund'); },
  };
};

describe('Feature 4 — direct biller payment', () => {
  it('full payment marks the bill paid and records a biller confirmation', async () => {
    const rows: PaymentLedgerRow[] = [];
    const gw = okGateway();
    const res = await fundBill({
      bill: { id: 'bill-1', amountCents: 24_050, fundedCents: 0 },
      payerId: 'payer-1',
      amountCents: 24_050,
      feeCents: 99,
      gateway: gw,
      persist: async (r) => { rows.push({ ...r }); },
    });
    expect(res.billStatusAfter).toBe('paid');
    expect(res.remainingCents).toBe(0);
    expect(res.payment.status).toBe('sent_to_biller');
    expect(res.payment.billerConfirmation).toBe('BILLER-98765');
  });

  it('partial funding leaves a republishable remaining balance (Flow 3)', async () => {
    const res = await fundBill({
      bill: { id: 'bill-2', amountCents: 24_050, fundedCents: 4_000 },
      payerId: 'payer-1',
      amountCents: 10_000,
      feeCents: 99,
      gateway: okGateway(),
      persist: async () => {},
    });
    expect(res.billStatusAfter).toBe('partially_funded');
    expect(res.remainingCents).toBe(10_050);
  });

  it('refuses amounts above the outstanding balance', async () => {
    await expect(
      fundBill({
        bill: { id: 'bill-3', amountCents: 5_000, fundedCents: 0 },
        payerId: 'p', amountCents: 5_001, feeCents: 0,
        gateway: okGateway(), persist: async () => {},
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
  });

  it('releases to the biller ONLY after authorization clears (PRD requirement)', async () => {
    const gw = okGateway(false); // declined
    await expect(
      fundBill({
        bill: { id: 'bill-4', amountCents: 5_000, fundedCents: 0 },
        payerId: 'p', amountCents: 5_000, feeCents: 0,
        gateway: gw, persist: async () => {},
      }),
    ).rejects.toThrow();
    expect(gw.calls).not.toContain('send_to_biller'); // nothing sent downstream on decline
  });

  it('state machine only allows PRD transitions', () => {
    expect(canTransition('authorized', 'captured')).toBe(true);
    expect(canTransition('confirmed', 'authorized')).toBe(false);
    expect(canTransition('failed', 'reversed')).toBe(true);
    expect(canTransition('reversed', 'captured')).toBe(false);
  });
});
