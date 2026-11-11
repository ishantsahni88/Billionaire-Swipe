/**
 * Bill Swipe API contract — the single interface between mobile and backend.
 * Transcribed from docs/PRD.md Features 1–7 + Analytics table.
 * This document is the source of truth for both sides; contract tests assert
 * the routes in backend/src/routes/api.ts against it.
 */

import type { BillCategory, PayQuote, PublicBillCard, SwipeAction } from './types';

type Route = { path: string; note?: string; sla?: string };

export interface ApiErrorBody {
  code:
    | 'VALIDATION'
    | 'DUPLICATE_BILL'
    | 'PAYMENT_DECLINED'
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'RATE_LIMITED'
    | 'LEGAL_HOLD'; // e.g., payments disabled pending counsel sign-off (PRD Dependencies)
  message: string;
}

export const API_CONTRACT = {
  /** Auth: passwordless OTP (Tech Stack). devCode echoed only when NODE_ENV=test. */
  POST_otp_start: { path: '/v1/auth/otp/start', note: 'destination + channel(phone|email); dob checked for 18+ gate -> 403 FORBIDDEN' },
  POST_otp_verify: { path: '/v1/auth/otp/verify', note: '5 wrong attempts -> 429 RATE_LIMITED; replayed code -> 401' },

  /** Feature 1: upload returns a redacted preview for holder adjustment BEFORE submit */
  POST_bills_upload: { path: '/v1/bills', note: 'JPEG/PNG/PDF max 10MB; auto-redaction preview required pre-submit' },
  PATCH_bills_redaction: { path: '/v1/bills/:id/redaction', note: 'holder adjusts redaction boxes pre-submission' },
  POST_bills_submit: { path: '/v1/bills/:id/submit', note: 'fails closed: 409 DUPLICATE_BILL, 422 incomplete redaction' },
  GET_bills_status: { path: '/v1/bills/:id/status', note: 'StatusTimeline stages: uploaded/verified/funded/paid; holder-only, no PII to payers' },

  /** Ops console (Persona 3) */
  POST_ops_review: { path: '/v1/ops/bills/:id/review', note: 'ops role only; full checklist required or 400; approve publishes payer-safe card only' },

  /** Feature 3: feed */
  GET_feed: { path: '/v1/feed', sla: 'card stack loads < 1.5s p95', note: 'query: category, minCents, maxCents, urgent' },
  POST_swipes: { path: '/v1/bills/:id/swipe', note: 'action: pay|pass|save; response undoExpiresAt = now+5s' },
  POST_swipe_undo: { path: '/v1/swipes/:id/undo', note: 'rejected after the 5s window' },

  /** Feature 4: pay (gated by LEGAL_HOLD until counsel sign-off) */
  POST_quote: { path: '/v1/bills/:id/quote', note: 'ALWAYS shows final amount + fee before charging; billerLabel is a category in pilot' },
  POST_pay: { path: '/v1/payments', note: 'amountCents <= balance; partial funding republishes remainder' },

  /** Feature 6: thank-you relay */
  POST_thankyou: { path: '/v1/payments/:id/thankyou', note: '<=280 chars, auto-moderated, delivered within 1h; no replies in MVP' },

  /** Feature 7: payer dashboard */
  GET_dashboard: { path: '/v1/payer/dashboard', sla: 'updates within 5 min of payment confirmation', note: 'totalFundedCents, billsFunded, categories, PDF receipts' },
  GET_receipt_pdf: { path: '/v1/receipts/:paymentId.pdf', note: 'owner-only; other payers get 404 (existence not confirmed); no PII inside' },

  /** Safety: report pauses bill immediately (PRD Content & Fraud Controls) */
  POST_report: { path: '/v1/bills/:id/report', note: 'bill paused pending ops review within 2 business days' },

  /** User Flow 4: disputes */
  POST_disputes: { path: '/v1/disputes', note: 'opens case, pauses bill, dueBy = +2 business days' },
  POST_dispute_refund: { path: '/v1/disputes/:id/refund', note: 'ops only; refund routes THROUGH licensed partner; republish within 1h' },
} as const satisfies Record<string, Route>;

export type ApiRoute = keyof typeof API_CONTRACT;
