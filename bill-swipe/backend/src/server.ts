/**
 * Bill Swipe API server entrypoint.
 *
 * PRD Launch-plan gating, encoded as code:
 *   - The payment routes are DEAD until legal counsel signs off on the money
 *     transmission structure. That sign-off is represented by the env var
 *     PAYMENTS_LEGAL_SIGNOFF_REF carrying a reference to the counsel memo.
 *     No boolean flag can be flipped without a ref — you cannot "just enable
 *     payments" by accident.
 *   - Everything runs against in-memory adapters here so `npm run dev` boots
 *     with zero infrastructure for the clickable prototype (Next Steps:
 *     "Build a clickable prototype of the swipe feed and pay flow").
 *     Postgres/Redis adapters replace these at implementation time; the
 *     AppDeps.db interface is the seam.
 */

import { buildApp, type AppDeps } from './routes/api.js';
import { AnalyticsTracker } from './services/analytics.js';
import { MockPaymentPartner } from './services/partnerMock.js';
import type { PublicBillCard } from '@bill-swipe/shared';
import type { PaymentLedgerRow } from './services/payments.js';
import type { SwipeRecord } from './services/feed.js';
import type { Dispute } from './services/disputes.js';
import type { ThankYouState, NewThankYouRecord } from './services/thankYou.js';

export type MemoryDb = ReturnType<typeof memoryDb>;

// ------------------------------------------------------- in-memory adapters ----

function memoryDb(seedFeed: PublicBillCard[] = []) {
  const payments = new Map<string, PaymentLedgerRow>();
  const swipes = new Map<string, SwipeRecord & { id: string }>();
  const disputes: Dispute[] = [];
  const thankYous: { id: string; paymentId: string; body: string; state: ThankYouState; createdAtMs: number; deliverByMs: number }[] = [];
  const paused = new Set<string>();
  let swipeSeq = 0;
  return {
    async feedPool() { return seedFeed.filter((c) => !paused.has(c.id)); },
    async swipes(payerId: string) { return [...swipes.values()].filter((s) => s.payerId === payerId); },
    async getBill(id: string) {
      const c = seedFeed.find((x) => x.id === id);
      if (!c) return null;
      return { id: c.id, amountCents: c.amountCents, fundedCents: c.fundedCents, status: c.status, category: c.category };
    },
    async insertPayment(row: unknown) { const r = row as PaymentLedgerRow; payments.set(r.id, r); },
    async saveThankYou(rec: NewThankYouRecord) {
      // Records carry an id + full state so the ops moderation queue can list
      // and resolve 'pending' messages (Feature 6 review path). The store owns
      // identity; compose-time records arrive without one.
      thankYous.push({
        id: crypto.randomUUID(),
        paymentId: rec.paymentId,
        body: rec.body,
        state: rec.state,
        createdAtMs: rec.createdAtMs,
        deliverByMs: rec.deliverByMs, // PT1H delivery SLA, computed at compose time
      });
    },
    async thankYousForPayment(paymentId: string) { return thankYous.filter((t) => t.paymentId === paymentId); },
    async pendingModerationQueue() { return thankYous.filter((t) => t.state === 'pending'); },
    async setThankYouState(id: string, state: ThankYouState) {
      const i = thankYous.findIndex((t) => t.id === id && t.state === 'pending');
      if (i < 0) return null;
      thankYous[i] = { ...thankYous[i], state };
      return thankYous[i];
    },
    async pauseBill(billId: string) { paused.add(billId); },
    async paymentsForPayer(payerId: string) { return [...payments.values()].filter((p) => p.payerId === payerId); },
    async getPayment(id: string) { return payments.get(id) ?? null; },
    billCategory(billId: string) { return seedFeed.find((x) => x.id === billId)?.category; },
    async getSwipe(id: string) { return swipes.get(id) ?? null; },
    async removeSwipe(sw: SwipeRecord) { for (const [k, v] of swipes) if (v.billId === sw.billId && v.createdAt === sw.createdAt) swipes.delete(k); },
    async insertDispute(d: unknown) { disputes.push(d as Dispute); },
    async updatePayment(row: PaymentLedgerRow) { payments.set(row.id, row); },
    addSwipe(s: SwipeRecord): string { const id = `sw-${++swipeSeq}`; swipes.set(id, { ...s, id }); return id; },
  };
}

export function makeDeps(env: NodeJS.ProcessEnv = process.env): AppDeps {
  // GATING ITEM (PRD Dependencies/Risks): counsel memo reference required.
  const signoffRef = env.PAYMENTS_LEGAL_SIGNOFF_REF?.trim();
  const db = memoryDb([]);
  return {
    db,
    gateway: new MockPaymentPartner(),
    tracker: new AnalyticsTracker({ ingest: () => {} }, env.OPS_SALT ?? 'dev-salt'),
    paymentsLegallyApproved: Boolean(signoffRef),
    kycOf: () => 'approved', // dev stub; real impl reads payer KYC records
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = buildApp(makeDeps());
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: '127.0.0.1' }).then(() => {
    app.log.info(`Bill Swipe API listening on :${port}`);
    if (!process.env.PAYMENTS_LEGAL_SIGNOFF_REF) {
      app.log.warn('PAYMENTS LEGAL HOLD ACTIVE — quote/pay return 503 until counsel sign-off ref is set');
    }
  });
}
