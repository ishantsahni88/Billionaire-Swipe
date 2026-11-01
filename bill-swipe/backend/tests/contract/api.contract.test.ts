import { describe, it, expect } from 'vitest';
import { buildApp, type AppDeps } from '../../src/routes/api';
import type { PublicBillCard } from '@bill-swipe/shared';
import { AnalyticsTracker } from '../../src/services/analytics';
import type { PartnerGateway } from '../../src/services/payments';

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

function makeDeps(paymentsLegallyApproved: boolean): AppDeps {
  const gateway: PartnerGateway = {
    async authorize() { return { txnId: 'txn_x', ok: true }; },
    async sendToBiller() { return { confirmation: 'BILLER-1' }; },
    async refund() {},
  };
  const sink = { ingest: () => {} };
  return {
    paymentsLegallyApproved,
    gateway,
    tracker: new AnalyticsTracker(sink, 'salt'),
    db: {
      async feedPool() { return pool; },
      async swipes() { return []; },
      async getBill(id) {
        if (id !== BILL_ID) return null;
        return { id, amountCents: 24_050, fundedCents: 0, status: 'published', category: 'utility' };
      },
      async insertPayment() {},
      async saveThankYou() {},
      async pauseBill() {},
    },
  };
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
