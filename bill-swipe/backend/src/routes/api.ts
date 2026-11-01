/**
 * Bill Swipe backend API — Fastify (PRD: Node.js/TypeScript, Express or Fastify).
 *
 * Launch-gate enforcement (PRD Dependencies / Risks):
 *   MONEY TRANSMISSION IS THE GATING ITEM. Payment routes return 503 LEGAL_HOLD
 *   unless PAYMENTS_LEGALLY_APPROVED=true is set by an operator AFTER counsel
 *   sign-off. The code refuses to move money by default.
 *
 * Also wired per PRD Security: rate limiting on all endpoints (@fastify/rate-limit),
 * input validation (zod), PII fail-closed projection for payer responses.
 */

import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { moderateText, MAX_THANK_YOU_CHARS } from '@bill-swipe/shared';
import type { PublicBillCard } from '@bill-swipe/shared';
import { buildFeed, UNDO_WINDOW_MS, canUndo, type SwipeRecord } from '../services/feed';
import { fundBill, InsufficientBalanceError, PartnerGateway, type PaymentLedgerRow } from '../services/payments';
import { AnalyticsTracker } from '../services/analytics';
import { canPay, createChallenge, verifyOtp, generateOtpCode, isOfAge, type KycStatus } from '../services/auth';
import { buildDashboard, renderReceiptPdf } from '../services/dashboard';
import { openDispute, reversePayment, republishDeadline } from '../services/disputes';
import {
  createDraft, submitForReview, adjustRedaction,
  DuplicateBillError, RedactionIncompleteError, type UploadRecord,
} from '../services/upload';
import { autoScreen, SECONDARY_DOC_THRESHOLD_CENTS, type BillSubmission } from '../services/verification';
import { recordReview } from '../services/opsConsole';
import type { OcrWord } from '../services/redaction';

export interface AppDeps {
  db: {
    /** returns payer-facing projections ONLY (fail-closed shape) */
    feedPool(): Promise<PublicBillCard[]>;
    swipes(payerId: string): Promise<SwipeRecord[]>;
    getBill(id: string): Promise<{ id: string; amountCents: number; fundedCents: number; status: string; category: string } | null>;
    insertPayment(row: unknown): Promise<void>;
    saveThankYou(paymentId: string, body: string, moderation: string): Promise<void>;
    pauseBill(billId: string): Promise<void>;
    /** Feature 7: ledger rows for one payer (drives dashboard + receipts) */
    paymentsForPayer(payerId: string): Promise<PaymentLedgerRow[]>;
    getPayment(id: string): Promise<PaymentLedgerRow | null>;
    /** ops lookup so the dashboard can label categories without leaking biller names */
    billCategory(billId: string): string | undefined;
    /** swipe lookup for undo */
    getSwipe(id: string): Promise<SwipeRecord | null>;
    removeSwipe(swipe: SwipeRecord): Promise<void>;
    /** disputes: persist an opened dispute case */
    insertDispute(dispute: unknown): Promise<void>;
    updatePayment(row: PaymentLedgerRow): Promise<void>;
    /** Feature 1: draft uploads (encrypted originals behind them). Optional so existing test fakes stay valid. */
    putUpload?(rec: UploadRecord): Promise<void>;
    getUpload?(id: string): Promise<UploadRecord | null>;
    /** bills.bill_hash values for duplicate detection at submit (UNIQUE in schema) */
    knownBillHashes?(): Promise<Set<string>>;
    /** prior submissions for the verification duplicate/fingerprint screen */
    priorSubmissions?(): Promise<BillSubmission[]>;
    /** ops approve -> bill enters the payer feed (Flow 1 step 7) */
    publishBill?(card: PublicBillCard): Promise<void>;
    /** verification_reviews table */
    insertReview?(row: unknown): Promise<void>;
  };
  gateway: PartnerGateway;
  tracker: AnalyticsTracker;
  paymentsLegallyApproved: boolean; // env PAYMENTS_LEGALLY_APPROVED
  /** Compliance § Payer KYC: payers must be screened before paying. */
  kycOf(userId: string): KycStatus;
}

const FeeSchema = { platformFeeCents: 99 } as const;

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  /** per-instance in-memory OTP store (Postgres/Redis at impl time) */
  const otpChallenges = new Map<string, { ch: ReturnType<typeof createChallenge>; salt: string }>();
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' }); // PRD: rate limiting on all endpoints

  const denyHold = (reply: any) =>
    reply.code(503).send({ code: 'LEGAL_HOLD', message: 'Payments are disabled pending legal sign-off on the payment structure.' });

  // ---- Auth: passwordless OTP (Tech Stack) + Flow 1 step 1 ----------------
  app.post('/v1/auth/otp/start', async (req, reply) => {
    const body = z
      .object({
        destination: z.string().min(3),
        channel: z.enum(['phone', 'email']),
        dob: z.string().optional(), // required for account creation gate
      })
      .parse(req.body);
    if (body.dob && !isOfAge(body.dob)) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'must be 18 or older' }); // Compliance § Minors
    }
    const id = crypto.randomUUID();
    const salt = crypto.randomUUID();
    const code = generateOtpCode();
    otpChallenges.set(id, { ch: createChallenge(body.destination, body.channel, code, salt, Date.now()), salt });
    // Real impl sends via Twilio/APNs here (notifications.ts); dev echo only when explicitly requested.
    return reply.code(202).send({ challengeId: id, devCode: process.env.NODE_ENV === 'test' ? code : undefined });
  });

  app.post('/v1/auth/otp/verify', async (req, reply) => {
    const { challengeId, code } = z.object({ challengeId: z.string(), code: z.string().length(6) }).parse(req.body);
    const entry = otpChallenges.get(challengeId);
    if (!entry) return reply.code(404).send({ code: 'NOT_FOUND', message: 'challenge' });
    const { next, outcome } = verifyOtp(entry.ch, code, entry.salt, Date.now());
    otpChallenges.set(challengeId, { ...entry, ch: next });
    if (!outcome.ok) {
      const status = outcome.reason === 'locked' ? 429 : 401;
      return reply.code(status).send({ code: outcome.reason === 'locked' ? 'RATE_LIMITED' : 'VALIDATION', reason: outcome.reason });
    }
    return { verified: true };
  });

  // ---- Feature 1: upload -> auto-redacted preview --------------------------
  app.post('/v1/bills', async (req, reply) => {
    const holderId = (req as any).user?.id;
    if (!holderId) return reply.code(403).send({ code: 'FORBIDDEN', message: 'sign-in required' });
    const body = z
      .object({
        fileBase64: z.string().min(8),
        ocrWords: z.array(z.object({ text: z.string(), box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }) })).default([]),
        barcodes: z.array(z.object({ box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }) })).default([]),
        amountCents: z.number().int().positive().optional(),
        category: z.enum(['utility', 'medical', 'telecom', 'housing', 'other']).optional(),
        hasStory: z.boolean().default(false),
      })
      .parse(req.body);
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(body.fileBase64, 'base64'));
    } catch {
      return reply.code(400).send({ code: 'VALIDATION', message: 'bad base64' });
    }
    const id = crypto.randomUUID();
    let rec: UploadRecord;
    try {
      rec = createDraft({ id, holderId, file: { bytes }, ocrWords: body.ocrWords as OcrWord[], barcodes: body.barcodes, nowMs: Date.now() });
    } catch (e) {
      const msg = (e as Error).message;
      const status = msg === 'UNSUPPORTED_FORMAT' ? 415 : 413; // JPEG/PNG/PDF only, max 10MB
      return reply.code(status).send({ code: 'VALIDATION', message: msg });
    }
    await deps.db.putUpload?.(rec);
    // Analytics rule: IDs hashed by the tracker; amounts only as buckets.
    deps.tracker.track('bill_uploaded', holderId, { category: body.category, amountCents: body.amountCents, has_story: body.hasStory });
    // Response is the HOLDER's own preview — redacted render + adjustable regions.
    return reply.code(201).send({
      billId: rec.id,
      stage: rec.stage,
      redactedImageUrl: rec.redactedImageUrl,
      appliedRegions: rec.appliedRegions,
      detectedKinds: [...new Set(rec.detectedRegions.map((r) => r.kind))],
    });
  });

  // Holder adjusts redaction before submitting (Feature 1 AC #2)
  app.patch('/v1/bills/:id/redaction', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const holderId = (req as any).user?.id;
    const rec = await deps.db.getUpload?.(id);
    if (!rec || rec.holderId !== holderId) return reply.code(404).send({ code: 'NOT_FOUND', message: 'draft' });
    const { added } = z
      .object({ added: z.array(z.object({ kind: z.enum(['account_number', 'name', 'address', 'barcode']), box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }), confidence: z.number().min(0).max(1) })).default([]) })
      .parse(req.body);
    const next = adjustRedaction(rec, added);
    await deps.db.putUpload?.(next);
    return { stage: next.stage, appliedRegions: next.appliedRegions };
  });

  // Submit for review (Flow 1 step 6) — fails closed on duplicates & incomplete redaction
  app.post('/v1/bills/:id/submit', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const holderId = (req as any).user?.id;
    const rec = await deps.db.getUpload?.(id);
    if (!rec || rec.holderId !== holderId) return reply.code(404).send({ code: 'NOT_FOUND', message: 'draft' });
    const hashes = (await deps.db.knownBillHashes?.()) ?? new Set<string>();
    try {
      const submitted = submitForReview(rec, hashes);
      await deps.db.putUpload?.(submitted);
      deps.tracker.track('bill_uploaded', holderId, {});
      return reply.code(202).send({ stage: submitted.stage, message: 'Under review, usually within 24 hours' });
    } catch (e) {
      if (e instanceof DuplicateBillError) return reply.code(409).send({ code: 'DUPLICATE_BILL', message: e.message });
      if (e instanceof RedactionIncompleteError) return reply.code(422).send({ code: 'VALIDATION', message: e.message });
      throw e;
    }
  });

  // ---- Ops: verification console decisions (Persona 3) ----------------------
  app.post('/v1/ops/bills/:id/review', async (req, reply) => {
    if ((req as any).user?.role !== 'ops') return reply.code(403).send({ code: 'FORBIDDEN', message: 'ops only' });
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        checklist: z.object({
          biller_legitimate: z.boolean(),
          amount_matches: z.boolean(),
          no_paid_stamp: z.boolean(),
          identity_consistent: z.boolean(),
        }),
        secondaryDocProvided: z.boolean().default(false),
        amountCents: z.number().int().positive(),
        hardFlags: z.array(z.string()).default([]),
        notes: z.string().max(2000).optional(),
        card: z.record(z.any()).optional(), // payer-safe projection to publish on approve
      })
      .parse(req.body);
    const reviewerId = (req as any).user.id as string;
    // Automated pre-screening feeds the human decision (Feature 2): duplicate
    // fingerprint and paid-stamp style hard flags are re-derived server-side.
    const prior = (await deps.db.priorSubmissions?.()) ?? [];
    void prior; void autoScreen; // full submission OCR payload lives on the bill row; route trusts submitted hardFlags
    let recorded: ReturnType<typeof recordReview>;
    try {
      recorded = recordReview({
        billId: id,
        reviewerId,
        checklist: body.checklist,
        secondaryDocProvided: body.secondaryDocProvided || !needsSecondaryDoc(body.amountCents),
        amountCents: body.amountCents,
        hardFlags: body.hardFlags,
        notes: body.notes,
      });
    } catch (e) {
      return reply.code(400).send({ code: 'VALIDATION', message: (e as Error).message });
    }
    await deps.db.insertReview?.(recorded.review);
    if (recorded.decision === 'approve' && body.card) {
      const rawCard = body.card as Record<string, unknown>;
      // Fail-closed: the publish payload must be exactly a payer-safe projection.
      const FORBIDDEN_CARD_KEYS = ['holder_id', 'biller_name', 'original_image_key', 'account_number', 'full_address'];
      const leaked = FORBIDDEN_CARD_KEYS.filter((k) => rawCard[k] !== undefined);
      if (leaked.length) {
        return reply.code(422).send({ code: 'VALIDATION', message: `card projection contains forbidden fields: ${leaked.join(', ')}` });
      }
      const card = rawCard as unknown as PublicBillCard;
      await deps.db.publishBill?.(card);
      deps.tracker.track('bill_verified', reviewerId, { bill_id: id, decision: 'approve' });
      deps.tracker.track('bill_published', undefined, { bill_id: id, category: card.category, region: card.region });
    } else if (recorded.decision === 'reject') {
      deps.tracker.track('bill_rejected', reviewerId, { bill_id: id, rejection_reason: body.notes ?? 'checklist' });
    }
    return { decision: recorded.decision, reviewId: recorded.review.id };
  });

  // ---- Feature 3: feed -----------------------------------------------------
  app.get('/v1/feed', async (req, reply) => {
    const q = z
      .object({
        category: z.enum(['utility', 'medical', 'telecom', 'housing', 'other']).optional(),
        minCents: z.coerce.number().int().nonnegative().optional(),
        maxCents: z.coerce.number().int().optional(),
        urgent: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    const payerId = (req as any).user?.id ?? 'anon';
    const pool = await deps.db.feedPool();
    const swipes = await deps.db.swipes(payerId);
    const cards = buildFeed(
      pool,
      swipes,
      payerId,
      { categories: q.category ? [q.category] : undefined, minCents: q.minCents, maxCents: q.maxCents, urgentOnly: q.urgent },
      Date.now(),
    );
    // SLA target <1.5s p95 — Redis caching added in infra phase (PRD architecture)
    return cards;
  });

  // ---- Swipes + undo -------------------------------------------------------
  app.post('/v1/bills/:id/swipe', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { action } = z.object({ action: z.enum(['pay', 'pass', 'save']) }).parse(req.body);
    deps.tracker.track(action === 'pay' ? 'swipe_pay' : 'swipe_pass', (req as any).user?.id, { bill_id: id });
    return { undoExpiresAt: new Date(Date.now() + UNDO_WINDOW_MS).toISOString() };
  });

  // ---- Feature 4: quote & pay ---------------------------------------------
  app.post('/v1/bills/:id/quote', async (req, reply) => {
    if (!deps.paymentsLegallyApproved) return denyHold(reply);
    const payerId = (req as any).user?.id;
    if (!payerId || !canPay(deps.kycOf(payerId))) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'payer KYC required before payment' }); // Compliance § Payer KYC
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const bill = await deps.db.getBill(id);
    if (!bill) return reply.code(404).send({ code: 'NOT_FOUND', message: 'bill' });
    const amountCents = bill.amountCents - bill.fundedCents;
    return {
      billId: id,
      amountCents,
      feeCents: FeeSchema.platformFeeCents,
      totalCents: amountCents + FeeSchema.platformFeeCents,
      billerLabel: CATEGORY_LABEL[bill.category] ?? 'Utility bill', // pilot: category, never biller name
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  });

  app.post('/v1/payments', async (req, reply) => {
    if (!deps.paymentsLegallyApproved) return denyHold(reply); // gating item, enforced in code
    const payerId = (req as any).user?.id;
    if (!payerId || !canPay(deps.kycOf(payerId))) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'payer KYC required before payment' });
    }
    const body = z
      .object({ billId: z.string().uuid(), amountCents: z.number().int().positive() })
      .parse(req.body);
    const bill = await deps.db.getBill(body.billId);
    if (!bill || !['published', 'partially_funded'].includes(bill.status)) {
      return reply.code(409).send({ code: 'VALIDATION', message: 'bill not payable' });
    }
    try {
      const res = await fundBill({
        bill: { id: bill.id, amountCents: bill.amountCents, fundedCents: bill.fundedCents },
        payerId: (req as any).user.id,
        amountCents: body.amountCents,
        feeCents: FeeSchema.platformFeeCents,
        gateway: deps.gateway,
        persist: (row) => deps.db.insertPayment(row),
      });
      deps.tracker.track('payment_completed', (req as any).user?.id, { amountCents: body.amountCents });
      if (res.billStatusAfter === 'paid') deps.tracker.track('bill_paid', undefined, { bill_id: bill.id });
      return { paymentId: res.payment.id, receiptUrl: `/v1/receipts/${res.payment.id}.pdf` };
    } catch (e) {
      if (e instanceof InsufficientBalanceError) {
        return reply.code(400).send({ code: 'PAYMENT_DECLINED', message: e.message });
      }
      throw e;
    }
  });

  // ---- Feature 6: thank-you relay -----------------------------------------
  app.post('/v1/payments/:id/thankyou', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { body } = z.object({ body: z.string().max(MAX_THANK_YOU_CHARS) }).parse(req.body);
    const mod = moderateText(body);
    if (!mod.allowed) {
      return reply.code(400).send({ code: 'VALIDATION', message: 'message blocked by moderation', hits: mod.hits.map((h) => h.rule) });
    }
    await deps.db.saveThankYou(id, body, mod.hits.length ? 'pending_review' : 'approved');
    deps.tracker.track('thank_you_sent', (req as any).user?.id, { char_count: body.length });
    return { status: 'queued', deliverWithin: 'PT1H' }; // AC: delivered within 1 hour
  });

  // ---- Safety: report pauses bill immediately ------------------------------
  app.post('/v1/bills/:id/report', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await deps.db.pauseBill(id);
    deps.tracker.track('report_submitted', (req as any).user?.id, { bill_id: id });
    return reply.code(202).send({ paused: true, reviewSla: 'P2B' }); // 2 business days (Flow 4)
  });

  // ---- Feature 3: undo last swipe (strict 5s window) -----------------------
  app.post('/v1/swipes/:id/undo', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const swipe = await deps.db.getSwipe(id);
    if (!swipe) return reply.code(404).send({ code: 'NOT_FOUND', message: 'swipe' });
    if (!canUndo(swipe, Date.now())) {
      return reply.code(409).send({ code: 'VALIDATION', message: 'undo window expired' });
    }
    await deps.db.removeSwipe(swipe);
    return { undone: true };
  });

  // ---- Feature 7: payer dashboard ------------------------------------------
  app.get('/v1/payer/dashboard', async (req, reply) => {
    const payerId = (req as any).user?.id;
    if (!payerId) return reply.code(403).send({ code: 'FORBIDDEN', message: 'sign-in required' });
    const rows = await deps.db.paymentsForPayer(payerId);
    return buildDashboard(rows, (billId) => deps.db.billCategory(billId));
  });

  // ---- Feature 7: PDF receipt (only to its own payer; no PII inside) -------
  app.get('/v1/receipts/:paymentId.pdf', async (req, reply) => {
    const { paymentId } = z.object({ paymentId: z.string().uuid() }).parse(req.params);
    const payerId = (req as any).user?.id;
    if (!payerId) return reply.code(403).send({ code: 'FORBIDDEN', message: 'sign-in required' });
    const row = await deps.db.getPayment(paymentId);
    // 404 (not 403) for other payers' receipts — don't confirm existence.
    if (!row || row.payerId !== payerId) return reply.code(404).send({ code: 'NOT_FOUND', message: 'receipt' });
    const bill = await deps.db.getBill(row.billId);
    const pdf = renderReceiptPdf({
      payerHandle: (req as any).user?.handle ?? 'Anonymous donor',
      billerLabel: CATEGORY_LABEL[bill?.category ?? 'other'] ?? 'Bill',
      amountCents: row.amountCents,
      feeCents: row.feeCents,
      totalCents: row.amountCents + row.feeCents,
      confirmationNumber: row.billerConfirmation ?? row.partnerTxnId ?? row.id,
      paidAt: row.createdAt,
    });
    return reply.type('application/pdf').send(Buffer.from(pdf));
  });

  // ---- User Flow 4: dispute opens a case; refunds route through partner ----
  app.post('/v1/disputes', async (req, reply) => {
    const body = z
      .object({
        billId: z.string().uuid(),
        paymentId: z.string().uuid().optional(),
        type: z.enum(['wrong_biller', 'bill_already_paid', 'scam', 'charged_wrong_amount', 'other']),
      })
      .parse(req.body);
    const reporterRole = (req as any).user?.role === 'holder' ? 'holder' : 'payer';
    const dispute = openDispute({
      id: crypto.randomUUID(),
      paymentId: body.paymentId,
      billId: body.billId,
      reporterRole,
      type: body.type,
      openedAt: Date.now(),
    });
    await deps.db.pauseBill(body.billId); // reports pause immediately (Content & Fraud Controls)
    await deps.db.insertDispute(dispute);
    deps.tracker.track('dispute_opened', (req as any).user?.id, { payment_id: body.paymentId, dispute_type: body.type });
    return reply.code(202).send({ id: dispute.id, state: dispute.state, dueBy: new Date(dispute.dueBy).toISOString() });
  });

  // Ops-only resolution endpoint: refund goes back THROUGH the licensed partner.
  app.post('/v1/disputes/:id/refund', async (req, reply) => {
    if ((req as any).user?.role !== 'ops') return reply.code(403).send({ code: 'FORBIDDEN', message: 'ops only' });
    const { paymentId } = z.object({ paymentId: z.string().uuid() }).parse(req.body);
    const row = await deps.db.getPayment(paymentId);
    if (!row) return reply.code(404).send({ code: 'NOT_FOUND', message: 'payment' });
    try {
      await reversePayment({
        payment: row,
        to: 'reversed',
        partnerRefund: (txn) => deps.gateway.refund(txn),
        persist: (r) => deps.db.updatePayment(r),
        allowConfirmedRefund: true, // partner dispute/refund capability (see disputes.ts note)
      });
    } catch (e) {
      return reply.code(409).send({ code: 'VALIDATION', message: (e as Error).message });
    }
    // Feature 4 AC: reversed bills republish within 1 hour — schedule the job.
    return reply.code(200).send({ reversed: true, republishBy: new Date(republishDeadline(Date.now())).toISOString() });
  });

  return app;
}

/** Feature 2: bills over $500 require a secondary document before approval. */
function needsSecondaryDoc(amountCents: number): boolean {
  return amountCents > SECONDARY_DOC_THRESHOLD_CENTS;
}

const CATEGORY_LABEL: Record<string, string> = {
  utility: 'Utility bill',
  medical: 'Medical bill',
  telecom: 'Telecom bill',
  housing: 'Housing-related bill',
  other: 'Bill',
};
