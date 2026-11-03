/**
 * Bill Swipe — clickable preview server (PRD Next Steps: "Build a clickable
 * prototype of the swipe feed and pay flow").
 *
 * Boots the REAL API (routes/api.ts + services) with in-memory adapters,
 * seeded demo data, and dev conveniences so a browser can walk all four user
 * flows end-to-end. Production auth is passwordless OTP; for the preview we
 * attach users via an `x-demo-user` header instead (never enabled unless
 * DEMO_MODE=1, which only this file sets).
 *
 * Legal gating stays honest:
 *   - Default boot = payments on LEGAL HOLD (503), exactly like production.
 *   - `npm run preview -- --allow-payments` simulates counsel sign-off by
 *     setting PAYMENTS_LEGAL_SIGNOFF_REF; the hold banner in the UI reflects
 *     whichever mode you launched in.
 *
 * Run:  npx tsx backend/src/preview.ts [--allow-payments]
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

import { buildApp, type AppDeps } from './routes/api.js';
import { AnalyticsTracker } from './services/analytics.js';
import { MockPaymentPartner } from './services/partnerMock.js';
import { createDraft, submitForReview, type UploadRecord } from './services/upload.js';
import type { PaymentLedgerRow } from './services/payments.js';
import type { SwipeRecord } from './services/feed.js';
import type { Dispute } from './services/disputes.js';
import type { ThankYouState, ThankYouRecord } from './services/thankYou.js';
import type { PublicBillCard } from '@bill-swipe/shared';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML_FILE = path.resolve(HERE, '../../ops/preview.html');

// ----------------------------------------------------------------- demo users ----

type DemoUser = { id: string; role: 'holder' | 'payer' | 'ops'; handle?: string };
const DEMO_USERS: Record<string, DemoUser> = {
  riley: { id: 'demo-holder-riley', role: 'holder' },
  casey: { id: 'demo-holder-casey', role: 'holder' },
  dana: { id: 'demo-payer-dana', role: 'payer', handle: 'Quiet Comet' },
  sam: { id: 'demo-payer-sam', role: 'payer', handle: 'Patient River' },
  ops: { id: 'demo-ops-reviewer', role: 'ops' },
};

// ------------------------------------------------------------- seed fixtures ----

const uuid = () => crypto.randomUUID();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

/** Minimal fake OCR words carrying PII, so the redaction pipeline runs for real. */
function demoOcrWords() {
  return [
    { text: '930', box: { x: 60, y: 40, w: 30, h: 12 } },
    { text: 'King', box: { x: 95, y: 40, w: 35, h: 12 } },
    { text: 'St', box: { x: 135, y: 40, w: 18, h: 12 } },
    { text: 'Toronto', box: { x: 60, y: 56, w: 50, h: 12 } },
    { text: 'Account', box: { x: 60, y: 120, w: 55, h: 12 } },
    { text: 'No:', box: { x: 118, y: 120, w: 22, h: 12 } },
    { text: '4720-8815-3301', box: { x: 145, y: 120, w: 110, h: 12 } },
    { text: 'RILEY', box: { x: 60, y: 90, w: 45, h: 12 } },
    { text: 'BROOKS', box: { x: 110, y: 90, w: 60, h: 12 } },
    { text: 'Total', box: { x: 200, y: 300, w: 35, h: 12 } },
    { text: 'due', box: { x: 240, y: 300, w: 25, h: 12 } },
    { text: '$184.50', box: { x: 270, y: 300, w: 55, h: 12 } },
  ];
}

/** 1x1-ish valid JPEG payload (real SOI/EOI markers) — passes format sniffing. */
function demoFileBytes(): Uint8Array {
  const b64 =
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

function makeCard(over: Partial<PublicBillCard>): PublicBillCard {
  return {
    id: uuid(),
    category: 'utility',
    amountCents: 18_450,
    fundedCents: 0,
    balanceCents: over.amountCents ?? 18_450,
    dueDate: daysFromNow(5),
    region: 'Toronto, ON',
    status: 'published',
    ...over,
  };
}

const SEED_CARDS: PublicBillCard[] = [
  makeCard({ story: 'Single parent, hours away from hydro shutoff.', dueDate: daysFromNow(2) }),
  makeCard({ category: 'medical', amountCents: 42_000, balanceCents: 42_000, dueDate: daysFromNow(14), region: 'Ottawa, ON', story: 'Unexpected dental invoice after ER visit.' }),
  makeCard({ category: 'telecom', amountCents: 7_500, balanceCents: 7_500, dueDate: daysFromNow(3), region: 'Hamilton, ON', story: 'Phone line is the job-search lifeline.' }),
  makeCard({ category: 'utility', amountCents: 9_900, balanceCents: 3_900, fundedCents: 6_000, dueDate: daysFromNow(9), region: 'London, ON', status: 'partially_funded' }),
];

// --------------------------------------------------------------- demo store ----

function demoDb() {
  const cards = [...SEED_CARDS];
  /** bills published live via the ops-review route (id -> card) */
  const published = new Map<string, PublicBillCard>();
  /** full bill state incl. 'paid' — feed cards can't hold that status (shared type) */
  const billState = new Map<string, { fundedCents: number; status: string }>();
  for (const c of cards) billState.set(c.id, { fundedCents: c.fundedCents, status: c.status });
  const uploads = new Map<string, UploadRecord>();
  const payments = new Map<string, PaymentLedgerRow>();
  const swipes = new Map<string, SwipeRecord & { id: string }>();
  const disputes: Dispute[] = [];
  const reviews: unknown[] = [];
  const thankYous: { id: string; paymentId: string; body: string; state: ThankYouState; createdAtMs: number; deliverByMs: number }[] = [];
  const paused = new Set<string>();
  let swipeSeq = 0;

  // Preview-only: the production swipe route is fire-and-forget, so the demo
  // store exposes addSwipe and persists swipes at the hook layer (preview.ts).
  function addSwipe(s: SwipeRecord): string {
    const id = `sw-${++swipeSeq}`;
    swipes.set(id, { ...s, id });
    return id;
  }

  // Seed holder Riley's bill through the REAL upload service (draft -> submitted).
  const rileyRec = createDraft({
    id: uuid(), holderId: DEMO_USERS.riley.id, file: { bytes: demoFileBytes() },
    ocrWords: demoOcrWords(), barcodes: [{ box: { x: 300, y: 340, w: 90, h: 24 } }], nowMs: Date.now(),
  });
  uploads.set(rileyRec.id, submitForReview(rileyRec, new Set()));

  const db = {
    async feedPool() {
      return [...cards, ...published.values()].filter((c) => !paused.has(c.id));
    },
    async swipes(payerId: string) { return [...swipes.values()].filter((s) => s.payerId === payerId); },
    async getBill(id: string) {
      // Live bill rows: seeded feed cards PLUS anything published through the
      // real ops-review route (publishBill writes into `published`).
      const src = cards.find((x) => x.id === id) ?? published.get(id);
      if (!src) return null;
      const st = billState.get(id) ?? { fundedCents: src.fundedCents, status: src.status };
      return { id: src.id, amountCents: src.amountCents, fundedCents: st.fundedCents, status: st.status, category: src.category };
    },
    async insertPayment(row: unknown) {
      const r = row as PaymentLedgerRow;
      payments.set(r.id, r);
      // Demo convenience: advance the bill so feed + status timeline reflect funding live.
      const c = cards.find((x) => x.id === r.billId) ?? published.get(r.billId);
      if (c) {
        c.fundedCents += r.amountCents;
        c.balanceCents = Math.max(0, c.amountCents - c.fundedCents);
        const paid = c.balanceCents === 0;
        billState.set(c.id, { fundedCents: c.fundedCents, status: paid ? 'paid' : 'partially_funded' });
        // A paid bill leaves the payer pool (feedPool filters on card status).
        if (paid) c.status = 'published';
      }
      // PRD Feature 4 AC: biller confirmation recorded — mock partner already
      // returned CONF-* inside fundBill; auto-advance to 'confirmed' for the demo.
      if (r.status === 'sent_to_biller') {
        const confirmed = { ...r, status: 'confirmed' as const };
        payments.set(r.id, confirmed);
      }
    },
    async saveThankYou(rec: ThankYouRecord) {
      // Store owns identity on real backends; preview keeps the compose-time id.
      thankYous.push({ ...rec });
    },
    async thankYousForPayment(paymentId: string) { return thankYous.filter((t) => t.paymentId === paymentId); },
    async pendingModerationQueue() { return thankYous.filter((t) => t.state === 'pending'); },
    async getThankYouById(id: string) { return thankYous.find((t) => t.id === id) ?? null; },
    /** preview-only: full moderation list (all states) for the ops queue view */
    _thankYous() { return [...thankYous]; },
    async setThankYouState(id: string, state: ThankYouState) {
      const i = thankYous.findIndex((t) => t.id === id && t.state === 'pending');
      if (i < 0) return null;
      thankYous[i] = { ...thankYous[i], state };
      return thankYous[i];
    },
    /** preview-only delivery-worker seam: CAS approved -> delivered */
    async casMarkDelivered(id: string) { return this.setThankYouState(id, 'delivered' as ThankYouState); },
    async pauseBill(billId: string) { paused.add(billId); },
    async paymentsForPayer(payerId: string) { return [...payments.values()].filter((p) => p.payerId === payerId); },
    async getPayment(id: string) { return payments.get(id) ?? null; },
    billCategory(billId: string) { return cards.find((x) => x.id === billId)?.category; },
    async getSwipe(id: string) { return swipes.get(id) ?? null; },
    async removeSwipe(sw: SwipeRecord) {
      for (const [k, v] of swipes) if (v.billId === sw.billId && v.createdAt === sw.createdAt) swipes.delete(k);
    },
    async insertDispute(d: unknown) { disputes.push(d as Dispute); },
    async updatePayment(row: PaymentLedgerRow) {
      payments.set(row.id, row);
      if (row.status === 'reversed') {
        const c = cards.find((x) => x.id === row.billId) ?? published.get(row.billId);
        if (c) {
          c.fundedCents = Math.max(0, c.fundedCents - row.amountCents);
          c.balanceCents = c.amountCents - c.fundedCents;
          c.status = 'published';
          paused.delete(c.id); // dispute outcome republishes
        }
      }
    },
    async putUpload(rec: UploadRecord) { uploads.set(rec.id, rec); },
    async getUpload(id: string) { return uploads.get(id) ?? null; },
    async knownBillHashes() { return new Set([...uploads.values()].map((u) => u.billHash)); },
    async priorSubmissions() { return []; },
    async publishBill(card: PublicBillCard) {
      // Ops approve pushes a bill into the feed. Seeded cards mutate in place;
      // live uploads (whose id is the upload draft id) land in `published`.
      const existing = cards.find((c) => c.id === card.id);
      if (existing) Object.assign(existing, card);
      else published.set(card.id, card);
      const rec = uploads.get(card.id);
      if (rec) uploads.set(rec.id, { ...rec, stage: 'published' });
    },
    async insertReview(row: unknown) { reviews.push(row); },
    /** preview-only: persist a swipe so Pass/Undo behave like Feature 3 */
    addSwipe,
    /** preview-only introspection */
    _uploads: uploads,
    _submissions() {
      return [...uploads.values()]
        .filter((u) => u.stage === 'submitted')
        .map((u) => ({ billId: u.id, holderId: u.holderId, amountCents: null as number | null, stage: u.stage }));
    },
    _payments() { return [...payments.values()]; },
    _reviewsCount: () => reviews.length,
  };
  return db;
}

// ------------------------------------------------------------------ bootstrap ----

export function buildPreviewApp(env: NodeJS.ProcessEnv = process.env) {
  const allowPayments = env.PAYMENTS_LEGAL_SIGNOFF_REF !== undefined || process.argv.includes('--allow-payments');
  if (allowPayments) process.env.PAYMENTS_LEGAL_SIGNOFF_REF = 'MOCK-COUNSEL-MEMO-2026-11';

  const db = demoDb();
  const deps: AppDeps = {
    db,
    gateway: new MockPaymentPartner(),
    tracker: new AnalyticsTracker({ ingest: (e) => console.log('[analytics]', e.name) }, 'preview-salt'),
    paymentsLegallyApproved: Boolean(process.env.PAYMENTS_LEGAL_SIGNOFF_REF),
    kycOf: () => 'approved', // dev stub — same as server.ts
  };
  const api = buildApp(deps);

  // Dev identity shim: ONLY registered here (preview), never in routes/api.ts.
  api.addHook('onRequest', async (req) => {
    const key = String(req.headers['x-demo-user'] ?? '');
    const u = DEMO_USERS[key];
    if (u) (req as any).user = u;
  });

  // Preview-only: the production swipe route is fire-and-forget in production, but for a
  // clickable prototype we persist swipes so Pass truly hides the card for the
  // payer and Undo has a real record to remove (Feature 3 ACs).
  api.addHook('onSend', async (req, reply, payload) => {
    const m = req.url.match(/^\/v1\/bills\/([0-9a-f-]+)\/swipe$/);
    if (m && req.method === 'POST' && (req as any).user?.id && reply.statusCode === 200) {
      try {
        const action = (JSON.parse(String((req as any).body ?? '{}')) as { action?: string }).action;
        if (action === 'pass' || action === 'save') db.addSwipe({ payerId: (req as any).user.id, billId: m[1], action, createdAt: Date.now() });
      } catch { /* preview convenience only */ }
    }
    return payload;
  });

  return { api, deps, db, paymentsAllowed: Boolean(process.env.PAYMENTS_LEGAL_SIGNOFF_REF) };
}

async function main() {
  const { api, paymentsAllowed, db } = buildPreviewApp();
  const port = Number(process.env.PORT ?? 3000);

  await api.register(async (a) => {
    a.get('/', async (_req, reply) => {
      return reply.type('text/html').send(await readFile(HTML_FILE, 'utf8'));
    });
    a.get('/v1/preview/state', async (_req, reply) => {
      return reply.send({
        paymentsLegalHold: !paymentsAllowed,
        signoffRef: process.env.PAYMENTS_LEGAL_SIGNOFF_REF ?? null,
        demoUsers: Object.keys(DEMO_USERS),
        note: paymentsAllowed
          ? 'SIMULATED counsel sign-off (--allow-payments). Real launch requires a real memo ref.'
          : 'Payments return 503 LEGAL_HOLD until counsel signs off (PRD gating item).',
      });
    });
    // Preview-only ops introspection (verification queue + payment ids for the
    // thank-you flow). Never present in server.ts / production surface.
    a.get('/v1/preview/submissions', async (req, reply) => {
      if ((req as any).user?.role !== 'ops') return reply.code(403).send({ code: 'FORBIDDEN', message: 'ops only' });
      return db._submissions();
    });
    a.get('/v1/preview/payments', async (_req, reply) => {
      // Payer ids are internal; the holder needs *an* id to attach a thank-you.
      return db._payments().map((p) => ({ id: p.id, billId: p.billId, amountCents: p.amountCents, status: p.status }));
    });
    // Preview-only: run one delivery-worker tick so approved thank-yous move
    // to 'delivered' on demand (production runs this on a schedule).
    a.post('/v1/preview/deliver-tick', async (req, reply) => {
      if ((req as any).user?.role !== 'ops') return reply.code(403).send({ code: 'FORBIDDEN', message: 'ops only' });
      return runDeliveryTick(
        {
          async listByState(state) { return db._thankYous().filter((t) => t.state === state); },
          casMarkDelivered: (id: string) => db.casMarkDelivered(id),
        },
        { notifyPayer: async () => {}, trackSent: () => {} },
        Date.now(),
      );
    });
    // Preview helper: this holder's own uploads (the status route already 404s
    // other people's drafts — this just lists ids for the demo UI).
    a.get('/v1/preview/uploads', async (req, reply) => {
      const uid = (req as any).user?.id;
      if (!uid) return reply.code(403).send({ code: 'FORBIDDEN', message: 'sign-in required' });
      return [...db._uploads.values()]
        .filter((u) => u.holderId === uid)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((u) => ({ billId: u.id, stage: u.stage }));
    });
  });

  await api.listen({ port, host: '127.0.0.1' });
  console.log(`\n  Bill Swipe preview → http://127.0.0.1:${port}`);
  console.log(paymentsAllowed
    ? '  ⚠ payments ENABLED with MOCK partner + simulated legal sign-off'
    : '  🔒 payments on LEGAL HOLD (quote/pay return 503) — pass --allow-payments to simulate sign-off\n');
}

// Only auto-start when run directly (`tsx backend/src/preview.ts`), not on import.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
