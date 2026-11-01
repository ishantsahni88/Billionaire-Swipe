/**
 * Thank-you relay — PRD Feature 6.
 *
 * Rules encoded here (all from Feature 6 requirements + acceptance criteria):
 *   - ONE message per funded bill/payment (no replies in MVP — keeps the
 *     relationship one-directional and avoids harassment).
 *   - max 280 characters.
 *   - automated moderation before delivery; contact-info leaks and harassment
 *     are caught by shared/moderation.ts.
 *   - delivery within 1 hour of payment confirmation (SLA deadline computed at
 *     queue time; the notifications worker owns the actual push).
 *   - identities stay anonymous: the payer sees only a generic "anonymous
 *     donor" line (Feature 5), never the holder's name/handle.
 */

import { moderateText, MAX_THANK_YOU_CHARS } from '@bill-swipe/shared';

export type ThankYouState = 'pending' | 'approved' | 'rejected' | 'delivered';

export interface ThankYouRecord {
  id: string;
  paymentId: string;
  body: string; // <= MAX_THANK_YOU_CHARS, enforced here as well as by zod at the edge
  state: ThankYouState;
  createdAtMs: number;
  /** AC: delivered within 1 hour of payment confirmation */
  deliverByMs: number;
}

export const DELIVERY_SLA_MS = 60 * 60_000; // PT1H

export class DuplicateThankYouError extends Error {}
export class EmptyMessageError extends Error {}

/**
 * Compose a thank-you for a confirmed payment. Fails closed:
 *   - throws if a message already exists for this payment (one per funded bill)
 *   - throws on empty or over-length bodies
 *   - moderation verdict is stored on the record; `rejected` messages are NEVER
 *     queued for delivery.
 */
export function composeThankYou(opts: {
  id?: string;
  paymentId: string;
  body: string;
  existingForPayment?: ThankYouRecord[];
  nowMs?: number;
}): { record: ThankYouRecord; moderationHits: string[] } {
  const nowMs = opts.nowMs ?? Date.now();
  const trimmed = opts.body.trim();
  if (!trimmed) throw new EmptyMessageError('message is empty');
  if (trimmed.length > MAX_THANK_YOU_CHARS) {
    throw new Error(`message exceeds ${MAX_THANK_YOU_CHARS} characters`);
  }
  const prior = (opts.existingForPayment ?? []).filter((r) => r.paymentId === opts.paymentId);
  if (prior.length > 0) {
    throw new DuplicateThankYouError('one thank-you per payment (MVP: no replies)');
  }
  const mod = moderateText(trimmed);
  const record: ThankYouRecord = {
    id: opts.id ?? crypto.randomUUID(),
    paymentId: opts.paymentId,
    body: trimmed,
    state: mod.allowed ? (mod.hits.length ? 'pending' : 'approved') : 'rejected',
    createdAtMs: nowMs,
    deliverByMs: nowMs + DELIVERY_SLA_MS,
  };
  return { record, moderationHits: mod.hits.map((h) => h.rule) };
}

/**
 * Ops/automated review verdict on a `pending` message. Rejected messages stop
 * here — they are never delivered.
 */
export function applyModerationVerdict(record: ThankYouRecord, approve: boolean): ThankYouRecord {
  if (record.state === 'delivered') return record; // immutable once sent
  return { ...record, state: approve ? 'approved' : 'rejected' };
}

/** Delivery job eligibility: only approved messages inside their SLA window go out. */
export function eligibleForDelivery(record: ThankYouRecord, nowMs: number): boolean {
  return record.state === 'approved' && nowMs >= record.createdAtMs && nowMs <= record.deliverByMs;
}

export function markDelivered(record: ThankYouRecord): ThankYouRecord {
  if (record.state !== 'approved') throw new Error(`cannot deliver from state ${record.state}`);
  return { ...record, state: 'delivered' };
}

/**
 * Payer-facing render (Feature 5): strip everything but the text. The sender
 * line is a fixed generic string — there is no field through which a holder
 * identity could leak, by construction.
 */
export interface PayerThankYouView {
  senderLabel: 'Anonymous donor';
  text: string;
}

export function toPayerView(record: ThankYouRecord): PayerThankYouView {
  return { senderLabel: 'Anonymous donor', text: record.body };
}
