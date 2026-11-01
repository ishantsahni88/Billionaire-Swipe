/**
 * Contract tests for the routes added in the upload/auth/ops build phase:
 *   - POST /v1/auth/otp/start|verify  (passwordless login, lockout, 18+ gate)
 *   - POST /v1/bills                  (Feature 1 auto-redacted preview)
 *   - PATCH /v1/bills/:id/redaction   (holder adjusts redaction pre-submit)
 *   - POST /v1/bills/:id/submit       (fails closed: duplicates, incomplete redaction)
 *   - POST /v1/ops/bills/:id/review   (Persona 3 console; fail-closed publish)
 */

import { describe, it, expect } from 'vitest';
import { buildApp, type AppDeps } from '../../src/routes/api';
import { AnalyticsTracker } from '../../src/services/analytics';
import type { PartnerGateway, PaymentLedgerRow } from '../../src/services/payments';
import type { PublicBillCard } from '@bill-swipe/shared';
import type { SwipeRecord } from '../../src/services/feed';
import type { UploadRecord } from '../../src/services/upload';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64');
const PDF = Buffer.from('%PDF-1.4 hello world').toString('base64');
const GIF = Buffer.from('GIF89a........').toString('base64');

const box = { x: 10, y: 10, w: 200, h: 14 };
const acctWords = [{ text: 'Account 123456789012', box }];

function makeDeps() {
  const uploads = new Map<string, UploadRecord>();
  const hashes = new Set<string>();
  const published: PublicBillCard[] = [];
  const reviews: unknown[] = [];
  const gateway: PartnerGateway = {
    async authorize() { return { txnId: 'txn_1', ok: true }; },
    async sendToBiller() { return { confirmation: 'C1' }; },
    async refund() {},
  };
  const deps: AppDeps & { __uploads: typeof uploads; __hashes: typeof hashes; __published: typeof published; __reviews: typeof reviews } = {
    paymentsLegallyApproved: false,
    gateway,
    tracker: new AnalyticsTracker({ ingest: () => {} }, 'salt'),
    kycOf: () => 'approved',
    db: {
      async feedPool() { return published as PublicBillCard[]; },
      async swipes() { return [] as SwipeRecord[]; },
      async getBill() { return null; },
      async insertPayment() {},
      async saveThankYou() {},
      async pauseBill() {},
      async paymentsForPayer(): Promise<PaymentLedgerRow[]> { return []; },
      async getPayment() { return null; },
      billCategory() { return 'utility'; },
      async getSwipe() { return null; },
      async removeSwipe() {},
      async insertDispute() {},
      async updatePayment() {},
      async putUpload(rec) { uploads.set(rec.id, rec); hashes.add(rec.billHash); },
      async getUpload(id) { return uploads.get(id) ?? null; },
      async knownBillHashes() { return new Set(hashes); },
      async priorSubmissions() { return []; },
      async publishBill(card) { published.push(card); },
      async insertReview(row) { reviews.push(row); },
    },
    __uploads: uploads, __hashes: hashes, __published: published, __reviews: reviews,
  };
  return deps;
}

function asUser(app: ReturnType<typeof buildApp>, user: { id: string; role?: string }) {
  app.addHook('onRequest', async (req) => { (req as any).user = user; });
}

describe('contract — auth OTP (Tech Stack: passwordless)', () => {
  it('start returns a challenge; verify with the code succeeds', async () => {
    process.env.NODE_ENV = 'test';
    const app = buildApp(makeDeps());
    const s = await app.inject({ method: 'POST', url: '/v1/auth/otp/start', payload: { destination: '+14165551234', channel: 'phone' } });
    expect(s.statusCode).toBe(202);
    const { challengeId, devCode } = s.json();
    expect(devCode).toMatch(/^\d{6}$/);
    const v = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { challengeId, code: devCode } });
    expect(v.statusCode).toBe(200);
    // replay rejected
    const r = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { challengeId, code: devCode } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it('rejects minors at sign-up (Compliance § Minors)', async () => {
    const app = buildApp(makeDeps());
    const res = await app.inject({ method: 'POST', url: '/v1/auth/otp/start', payload: { destination: '+14165551234', channel: 'phone', dob: '2012-01-01' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    await app.close();
  });

  it('locks out after repeated wrong codes -> RATE_LIMITED', async () => {
    process.env.NODE_ENV = 'test';
    const app = buildApp(makeDeps());
    const s = await app.inject({ method: 'POST', url: '/v1/auth/otp/start', payload: { destination: 'a@b.ca', channel: 'email' } });
    const { challengeId } = s.json();
    let last;
    for (let i = 0; i < 5; i++) {
      last = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { challengeId, code: '000000' } });
    }
    expect(last!.statusCode).toBe(429);
    expect(last!.json().code).toBe('RATE_LIMITED');
    await app.close();
  });
});

describe('contract — Feature 1 upload & redaction', () => {
  it('accepts JPEG and returns an auto-redacted preview with regions applied', async () => {
    const app = buildApp(makeDeps());
    asUser(app, { id: 'holder-1', role: 'holder' });
    const res = await app.inject({ method: 'POST', url: '/v1/bills', payload: { fileBase64: JPEG, ocrWords: acctWords } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.stage).toBe('redacted_preview');
    expect(body.detectedKinds).toContain('account_number');
    expect(body.redactedImageUrl).toContain('/redacted/');
    // The encrypted original key must NEVER appear in a response.
    expect(JSON.stringify(body)).not.toContain('enc://');
    await app.close();
  });

  it('rejects non-JPEG/PNG/PDF files', async () => {
    const app = buildApp(makeDeps());
    asUser(app, { id: 'holder-1', role: 'holder' });
    const res = await app.inject({ method: 'POST', url: '/v1/bills', payload: { fileBase64: GIF } });
    expect(res.statusCode).toBe(415);
    await app.close();
  });

  it('requires sign-in', async () => {
    const app = buildApp(makeDeps());
    const res = await app.inject({ method: 'POST', url: '/v1/bills', payload: { fileBase64: JPEG } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('submit fails closed on duplicate bill hash (AC: exact re-upload caught 100%)', async () => {
    const deps = makeDeps();
    const app = buildApp(deps);
    asUser(app, { id: 'holder-1', role: 'holder' });
    const a = await app.inject({ method: 'POST', url: '/v1/bills', payload: { fileBase64: JPEG, ocrWords: acctWords } });
    const b = await app.inject({ method: 'POST', url: `/v1/bills/${a.json().billId}/submit` });
    expect(b.statusCode).toBe(202);
    const c = await app.inject({ method: 'POST', url: '/v1/bills', payload: { fileBase64: JPEG, ocrWords: acctWords } });
    const d = await app.inject({ method: 'POST', url: `/v1/bills/${c.json().billId}/submit` });
    expect(d.statusCode).toBe(409);
    expect(d.json().code).toBe('DUPLICATE_BILL');
    await app.close();
  });

  it('holder can adjust redaction before submitting (AC #2)', async () => {
    const app = buildApp(makeDeps());
    asUser(app, { id: 'holder-1', role: 'holder' });
    const a = await app.inject({ method: 'POST', url: '/v1/bills', payload: { fileBase64: PDF, ocrWords: [] } });
    const { billId } = a.json();
    const p = await app.inject({
      method: 'PATCH', url: `/v1/bills/${billId}/redaction`,
      payload: { added: [{ kind: 'name', box: { x: 5, y: 40, w: 120, h: 14 }, confidence: 0.9 }] },
    });
    expect(p.statusCode).toBe(200);
    expect(p.json().appliedRegions.some((r: any) => r.kind === 'name')).toBe(true);
    const s = await app.inject({ method: 'POST', url: `/v1/bills/${billId}/submit` });
    expect(s.statusCode).toBe(202);
    await app.close();
  });

  it('another holder cannot touch someone else\u2019s draft (ownership enforced)', async () => {
    const deps = makeDeps();
    const app = buildApp(deps);
    app.addHook('onRequest', async (req) => {
      (req as any).user = String(req.url).includes('holder=2') ? { id: 'holder-2', role: 'holder' } : { id: 'holder-1', role: 'holder' };
    });
    const a = await app.inject({ method: 'POST', url: '/v1/bills', payload: { fileBase64: JPEG, ocrWords: acctWords } });
    const billId = a.json().billId;
    // holder-2 tries to adjust holder-1's draft -> 404 (don't confirm existence)
    const p = await app.inject({ method: 'PATCH', url: `/v1/bills/${billId}/redaction?holder=2`, payload: { added: [] } });
    expect(p.statusCode).toBe(404);
    const s = await app.inject({ method: 'POST', url: `/v1/bills/${billId}/submit?holder=2` });
    expect(s.statusCode).toBe(404);
    await app.close();
  });
});

describe('contract — ops review console (Persona 3)', () => {
  const goodChecklist = { biller_legitimate: true, amount_matches: true, no_paid_stamp: true, identity_consistent: true };

  it('non-ops users are rejected', async () => {
    const app = buildApp(makeDeps());
    asUser(app, { id: 'payer-1', role: 'payer' });
    const res = await app.inject({ method: 'POST', url: '/v1/ops/bills/x/review', payload: { checklist: goodChecklist, amountCents: 1000 } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('approve publishes ONLY a payer-safe card; forbidden fields are refused', async () => {
    const deps = makeDeps();
    const app = buildApp(deps);
    asUser(app, { id: 'ops-1', role: 'ops' });
    const card = {
      id: '11111111-1111-4111-8111-111111111111', category: 'utility', amountCents: 24050, fundedCents: 0,
      balanceCents: 24050, dueDate: '2026-11-20', region: 'Toronto', status: 'published',
    };
    const ok = await app.inject({ method: 'POST', url: '/v1/ops/bills/b1/review', payload: { checklist: goodChecklist, amountCents: 24050, card } });
    expect(ok.json().decision).toBe('approve');
    expect(deps.__published.length).toBe(1);

    const leaky = await app.inject({
      method: 'POST', url: '/v1/ops/bills/b2/review',
      payload: { checklist: goodChecklist, amountCents: 24050, card: { ...card, holder_id: 'h1' } },
    });
    expect(leaky.statusCode).toBe(422);
    expect(deps.__published.length).toBe(1); // nothing leaked into the feed
    await app.close();
  });

  it('big bills without secondary doc -> request_more (Feature 2)', async () => {
    const app = buildApp(makeDeps());
    asUser(app, { id: 'ops-1', role: 'ops' });
    const res = await app.inject({
      method: 'POST', url: '/v1/ops/bills/b3/review',
      payload: { checklist: goodChecklist, amountCents: 60000, secondaryDocProvided: false },
    });
    expect(res.json().decision).toBe('request_more');
    await app.close();
  });

  it('incomplete checklist cannot be recorded as approve', async () => {
    const app = buildApp(makeDeps());
    asUser(app, { id: 'ops-1', role: 'ops' });
    const res = await app.inject({
      method: 'POST', url: '/v1/ops/bills/b4/review',
      payload: { checklist: { biller_legitimate: true, amount_matches: true, no_paid_stamp: true }, amountCents: 1000 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
