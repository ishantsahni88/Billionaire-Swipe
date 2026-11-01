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
import { buildFeed, UNDO_WINDOW_MS } from '../services/feed';
import { fundBill, InsufficientBalanceError, PartnerGateway } from '../services/payments';
import { AnalyticsTracker } from '../services/analytics';

export interface AppDeps {
  db: {
    /** returns payer-facing projections ONLY (fail-closed shape) */
    feedPool(): Promise<PublicBillCard[]>;
    swipes(payerId: string): Promise<{ payerId: string; billId: string; action: 'pay' | 'pass' | 'save'; createdAt: number }[]>;
    getBill(id: string): Promise<{ id: string; amountCents: number; fundedCents: number; status: string; category: string } | null>;
    insertPayment(row: unknown): Promise<void>;
    saveThankYou(paymentId: string, body: string, moderation: string): Promise<void>;
    pauseBill(billId: string): Promise<void>;
  };
  gateway: PartnerGateway;
  tracker: AnalyticsTracker;
  paymentsLegallyApproved: boolean; // env PAYMENTS_LEGALLY_APPROVED
}

const FeeSchema = { platformFeeCents: 99 } as const;

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' }); // PRD: rate limiting on all endpoints

  const denyHold = (reply: any) =>
    reply.code(503).send({ code: 'LEGAL_HOLD', message: 'Payments are disabled pending legal sign-off on the payment structure.' });

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

  return app;
}

const CATEGORY_LABEL: Record<string, string> = {
  utility: 'Utility bill',
  medical: 'Medical bill',
  telecom: 'Telecom bill',
  housing: 'Housing-related bill',
  other: 'Bill',
};
