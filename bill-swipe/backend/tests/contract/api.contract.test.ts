import { describe, it, expect } from 'vitest';
import { buildApp, type AppDeps } from '../../src/routes/api';
import type { PublicBillCard } from '@bill-swipe/shared';
import { AnalyticsTracker } from '../../src/services/analytics';
import type { PartnerGateway } from '../../src/services/payments';
import type { PaymentLedgerRow } from '../../src/services/payments';
import type { SwipeRecord } from '../../src/services/feed';
import type { Dispute } from '../../src/services/disputes';

const BILL_ID = '11111111-1111-4111-8111-111111111111';
const PAYMENT_ID = '22222222-2222-4222-8222-222222222222';

const pool: PublicBillCard[] = [
  {
    id: BILL_ID,
    category: 'utility',
    amountCents: 24_050,
    fundedCents: 0,
    balanceCents: 24_050,
    dueDate: '2026-11-20',
    region: 'Toronto',
    story: 'Hydro was cut off last week.',
    redactedImageUrl: 'https://cdn.example/redacted/aaa.jpg',
    status: 'published',
  },
];

/** In-memory fakes so route tests exercise real service code end-to-end. */
function makeDeps(paymentsLegallyApproved: boolean, opts: { kyc?: 'not_started' | 'pending' | 'approved' | 'rejected' } = {}) {
  const gateway: PartnerGateway = {
    async authorize() { return { txnId: 'txn_x', ok: true }; },
    async sendToBiller() { return { confirmation: 'BILLER-1' }; },
    async refund() {},
  };
  const sink = { ingest: () => {} };
  const payments = new Map<string, PaymentLedgerRow>();
  const swipes = new Map<string, SwipeRecord & { id: string }>();
  const disputes: Dispute[] = [];
  let swipeSeq = 0;
  const deps: AppDeps & { __payments: typeof payments; __swipes: typeof swipes; __disputes: typeof disputes; __addSwipe: (s: SwipeRecord) => string } = {
    paymentsLegallyApproved,
    gateway,
    tracker: new AnalyticsTracker(sink, 'salt'),
    kycOf: () => opts.kyc ?? 'approved',
    db: {
      async feedPool() { return pool; },
      async swipes() { return [...swipes.values()]; },
      async getBill(id) {
        if (id !== BILL_ID) return null;
        return { id, amountCents: 24_050, fundedCents: 0, status: 'published', category: 'utility' };
      },
      async insertPayment(row) { const r = row as PaymentLedgerRow; payments.set(r.id, r); },
      async saveThankYou() {},
      async pauseBill() {},
      async paymentsForPayer(payerId) { return [...payments.values()].filter((p) => p.payerId === payerId); },
      async getPayment(id) { return payments.get(id) ?? null; },
      billCategory() { return 'utility'; },
      async getSwipe(id) { return swipes.get(id) ?? null; },
      async removeSwipe(sw) { for (const [k, v] of swipes) if (v.billId === sw.billId && v.createdAt === sw.createdAt) swipes.delete(k); },
      async insertDispute(d) { disputes.push(d as Dispute); },
      async updatePayment(row) { payments.set(row.id, row); },
    },
    __payments: payments,
    __swipes: swipes,
    __disputes: disputes,
    __addSwipe(s) { const id = `sw-${++swipeSeq}`; swipes.set(id, { ...s, id }); return id; },
  };
  return deps;
}

/** Attach a fake authenticated user via Fastify preHandler hook on the instance. */
function asUser(app: ReturnType<typeof buildApp>, user: { id: string; role?: string; handle?: string }) {
  app.addHook('onRequest', async (req) => { (req as any).user = user; });
}

describe('API contract — Feature 3 feed', () => {
  it('GET /v1/feed returns payer-safe cards with NO personal identifiers', async () => {
    const app = buildApp(makeDeps(false));
    const res = await app.inject({ method: 'GET', url: '/v1/feed' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].id).toBe(BILL_ID);
    // Fail-closed projection check (Feature 5 AC): serialize the whole response
    // and assert no PII keys/values can appear at all.
    const raw = JSON.stringify(body).toLowerCase();
    for (const forbidden of ['holder', 'account_number', 'biller_name', 'street', 'address_line', 'jane', 'kowalski']) {
      expect(raw).not.toContain(forbidden);
    }
    await app.close();
  });
});

describe('API contract — Feature 4 legal gate (money transmission)', () => {
  it('quote and pay are DISABLED by default with LEGAL_HOLD until counsel signs off', async () => {
    const app = buildApp(makeDeps(false)); // default posture
    const q = await app.inject({ method: 'POST', url: `/v1/bills/${BILL_ID}/quote` });
    expect(q.statusCode).toBe(503);
    expect(q.json().code).toBe('LEGAL_HOLD');
    const p = await app.inject({ method: 'POST', url: '/v1/payments', payload: { billId: BILL_ID, amountCents: 24_050 } });
    expect(p.statusCode).toBe(503);
    expect(p.json().code).toBe('LEGAL_HOLD');
    await app.close();
  });

  it('with sign-off, quote shows final amount + fee BEFORE charging (AC)', async () => {
    const app = buildApp(makeDeps(true));
    asUser(app, { id: 'payer-uuid-1' }); // KYC defaults to approved in makeDeps
    const q = await app.inject({ method: 'POST', url: `/v1/bills/${BILL_ID}/quote` });
    expect(q.statusCode).toBe(200);
    const quote = q.json();
    expect(quote.amountCents + quote.feeCents).toBe(quote.totalCents);
    expect(quote.billerLabel).toBe('Utility bill'); // pilot: category only, never biller name
    await app.close();
  });
});

describe('API contract — Feature 6 thank-you moderation', () => {
  const appWith = () => { const a = buildApp(makeDeps(true)); return a; };

  it('accepts a clean message', async () => {
    const app = appWith();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/payments/${PAYMENT_ID}/thankyou`,
      payload: { body: 'Thank you — the lights are back on for my kids.' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('blocks contact-info leaks and off-platform payment requests', async () => {
    const app = appWith();
    for (const body of ['reach me at maya@example.com', 'or Venmo me directly please']) {
      const res = await app.inject({ method: 'POST', url: `/v1/payments/${PAYMENT_ID}/thankyou`, payload: { body } });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('moderation');
    }
    await app.close();
  });
});

describe('API contract — safety report pauses the bill', () => {
  it('POST /v1/bills/:id/report returns 202 paused', async () => {
    const app = buildApp(makeDeps(true));
    const res = await app.inject({ method: 'POST', url: `/v1/bills/${BILL_ID}/report`, payload: { reason: 'looks fake' } });
    expect(res.statusCode).toBe(202);
    expect(res.json().paused).toBe(true);
    await app.close();
  });
});

describe('API contract — Compliance § Payer KYC gate', () => {
  it('quote and pay return 403 FORBIDDEN until payer KYC is approved', async () => {
    const deps = makeDeps(true, { kyc: 'pending' });
    const app = buildApp(deps);
    asUser(app, { id: 'payer-uuid-1' });
    const q = await app.inject({ method: 'POST', url: `/v1/bills/${BILL_ID}/quote` });
    expect(q.statusCode).toBe(403);
    expect(q.json().code).toBe('FORBIDDEN');
    const p = await app.inject({ method: 'POST', url: '/v1/payments', payload: { billId: BILL_ID, amountCents: 24_050 } });
    expect(p.statusCode).toBe(403);
    await app.close();
  });

  it('approved payer can quote, pay, and lands on the ledger with a receipt URL', async () => {
    const deps = makeDeps(true, { kyc: 'approved' });
    const app = buildApp(deps);
    asUser(app, { id: 'payer-uuid-1' });
    const p = await app.inject({ method: 'POST', url: '/v1/payments', payload: { billId: BILL_ID, amountCents: 24_050 } });
    expect(p.statusCode).toBe(200);
    const { paymentId, receiptUrl } = p.json();
    expect(deps.__payments.get(paymentId)?.status).toBe('sent_to_biller'); // released only after auth cleared
    expect(receiptUrl).toBe(`/v1/receipts/${paymentId}.pdf`);
    await app.close();
  });
});

describe('API contract — Feature 3 undo window', () => {
  it('undo accepted within 5s, rejected after', async () => {
    const deps = makeDeps(true);
    const app = buildApp(deps);
    asUser(app, { id: 'payer-uuid-1' });
    const fresh = deps.__addSwipe({ payerId: 'payer-uuid-1', billId: BILL_ID, action: 'pass', createdAt: Date.now() });
    const stale = deps.__addSwipe({ payerId: 'payer-uuid-1', billId: BILL_ID, action: 'save', createdAt: Date.now() - 6_000 });
    const ok = await app.inject({ method: 'POST', url: `/v1/swipes/${fresh}/undo` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().undone).toBe(true);
    const late = await app.inject({ method: 'POST', url: `/v1/swipes/${stale}/undo` });
    expect(late.statusCode).toBe(409);
    await app.close();
  });
});

describe('API contract — Feature 7 dashboard + receipts', () => {
  it('dashboard aggregates only confirmed/sent money for the signed-in payer', async () => {
    const deps = makeDeps(true);
    const app = buildApp(deps);
    asUser(app, { id: 'payer-uuid-1' });
    await deps.db.insertPayment({ id: PAYMENT_ID, billId: BILL_ID, payerId: 'payer-uuid-1', amountCents: 24_050, feeCents: 99, partnerTxnId: 'txn_x', status: 'confirmed', billerConfirmation: 'BILLER-1', createdAt: new Date().toISOString() });
    await deps.db.insertPayment({ id: crypto.randomUUID(), billId: BILL_ID, payerId: 'someone-else', amountCents: 999, feeCents: 0, status: 'confirmed', createdAt: new Date().toISOString() });
    const d = await app.inject({ method: 'GET', url: '/v1/payer/dashboard' });
    expect(d.statusCode).toBe(200);
    expect(d.json().totalFundedCents).toBe(24_050);
    expect(d.json().billsFunded).toBe(1);

    const r = await app.inject({ method: 'GET', url: `/v1/receipts/${PAYMENT_ID}.pdf` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.body.startsWith('%PDF-')).toBe(true);
    expect(r.body).toContain('BILLER-1');

    // another payer gets 404, not 403 — do not confirm existence
    const other = buildApp(makeDeps(true));
    asUser(other, { id: 'payer-uuid-2' });
    const leak = await other.inject({ method: 'GET', url: `/v1/receipts/${PAYMENT_ID}.pdf` });
    expect(leak.statusCode).toBe(404);
    await app.close();
    await other.close();
  });
});

describe('API contract — User Flow 4 disputes', () => {
  it('opening a dispute pauses the bill and sets a 2-business-day SLA', async () => {
    const deps = makeDeps(true);
    const app = buildApp(deps);
    asUser(app, { id: 'payer-uuid-1', role: 'payer' });
    const res = await app.inject({ method: 'POST', url: '/v1/disputes', payload: { billId: BILL_ID, type: 'scam' } });
    expect(res.statusCode).toBe(202);
    const dueBy = new Date(res.json().dueBy);
    expect([1, 2, 3, 4, 5]).toContain(dueBy.getUTCDay()); // never a weekend
    expect(deps.__disputes).toHaveLength(1);
    await app.close();
  });

  it('ops refund reverses through the licensed partner and schedules republish <=1h', async () => {
    const deps = makeDeps(true);
    let refunded: string | undefined;
    (deps.gateway as PartnerGateway).refund = async (txn) => { refunded = txn; };
    const app = buildApp(deps);
    asUser(app, { id: 'ops-1', role: 'ops' });
    await deps.db.insertPayment({ id: PAYMENT_ID, billId: BILL_ID, payerId: 'payer-uuid-1', amountCents: 24_050, feeCents: 99, partnerTxnId: 'txn_x', status: 'captured', createdAt: new Date().toISOString() });
    const res = await app.inject({ method: 'POST', url: `/v1/disputes/d-1/refund`, payload: { paymentId: PAYMENT_ID } });
    expect(res.statusCode).toBe(200);
    expect(refunded).toBe('txn_x'); // money returns via partner, never from our balance
    expect(deps.__payments.get(PAYMENT_ID)!.status).toBe('reversed');
    const delta = Date.parse(res.json().republishBy) - Date.now();
    expect(delta).toBeGreaterThan(50 * 60_000);
    expect(delta).toBeLessThanOrEqual(60 * 60_000);

    // non-ops cannot refund
    const payer = buildApp(makeDeps(true));
    asUser(payer, { id: 'payer-uuid-1', role: 'payer' });
    const denied = await payer.inject({ method: 'POST', url: `/v1/disputes/d-1/refund`, payload: { paymentId: PAYMENT_ID } });
    expect(denied.statusCode).toBe(403);
    await app.close();
    await payer.close();
  });
});
