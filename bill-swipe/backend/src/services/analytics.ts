/**
 * Analytics tracker — PRD § "Analytics & Tracking".
 * Rule encoded here: holder/payer IDs are HASHED at ingestion; raw ids never leave.
 * Amounts go out as buckets except in ledger-sourced events.
 */

import { createHash } from 'crypto';

export const ANALYTICS_EVENTS = [
  'bill_uploaded',
  'bill_verified',
  'bill_rejected',
  'bill_published',
  'card_viewed',
  'swipe_pay',
  'swipe_pass',
  'payment_completed',
  'bill_paid',
  'thank_you_sent',
  'report_submitted',
  'dispute_opened',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export function hashId(id: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${id}`).digest('hex').slice(0, 32);
}

export function amountBucket(cents: number): 'lt_100' | '100_500' | '500_1000' | 'gt_1000' {
  if (cents < 10_000) return 'lt_100';
  if (cents < 50_000) return '100_500';
  if (cents < 100_000) return '500_1000';
  return 'gt_1000';
}

export interface TrackerSink {
  ingest(event: { name: AnalyticsEventName; props: Record<string, unknown>; ts: string }): void;
}

export class AnalyticsTracker {
  constructor(private sink: TrackerSink, private salt: string) {}

  track(name: AnalyticsEventName, userId: string | undefined, props: Record<string, unknown> = {}) {
    const clean: Record<string, unknown> = { ...props };
    // PII stripped at ingestion: replace raw ids with hashed ones
    if (userId) clean.hashed_user_id = hashId(userId, this.salt);
    for (const key of ['holder_id', 'payer_id', 'reviewer_id']) {
      if (typeof clean[key] === 'string') clean[`hashed_${key}`] = hashId(String(clean[key]), this.salt);
      delete clean[key];
    }
    if (typeof clean.amountCents === 'number' && !['payment_completed', 'bill_paid', 'swipe_pay'].includes(name)) {
      clean.amount_bucket = amountBucket(clean.amountCents as number);
      delete clean.amountCents;
    }
    this.sink.ingest({ name, props: clean, ts: new Date().toISOString() });
  }
}
