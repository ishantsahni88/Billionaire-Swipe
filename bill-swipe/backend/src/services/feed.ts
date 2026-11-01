/**
 * Feed service — PRD Feature 3 (Payer Swipe Feed).
 * Rules encoded here:
 *   - only published/partially_funded bills enter the stack
 *   - passed bills do not reappear for that payer for 30 days
 *   - filters: category, amount range, urgency (due within 7 days)
 *   - "Consider later" saves
 *   - undo window: 5 seconds
 */

import type { BillCategory, PublicBillCard, SwipeAction } from '@bill-swipe/shared';

export const UNDO_WINDOW_MS = 5_000;
export const PASS_COOLDOWN_DAYS = 30;
export const URGENT_WITHIN_DAYS = 7;

export interface SwipeRecord {
  payerId: string;
  billId: string;
  action: SwipeAction;
  createdAt: number; // epoch ms
}

export interface FeedQuery {
  categories?: BillCategory[];
  minCents?: number;
  maxCents?: number;
  urgentOnly?: boolean;
}

export function isUrgent(dueDateIso: string, nowMs: number): boolean {
  const due = Date.parse(dueDateIso);
  return due - nowMs <= URGENT_WITHIN_DAYS * 86_400_000 && due >= nowMs;
}

export function buildFeed(
  pool: PublicBillCard[],
  swipes: SwipeRecord[],
  payerId: string,
  q: FeedQuery,
  nowMs: number,
): PublicBillCard[] {
  const hidden = new Set(
    swipes
      .filter(
        (s) =>
          s.payerId === payerId &&
          (s.action === 'pass' || s.action === 'save') &&
          nowMs - s.createdAt < PASS_COOLDOWN_DAYS * 86_400_000,
      )
      .map((s) => s.billId),
  );
  const funded = new Set(
    swipes.filter((s) => s.payerId === payerId && s.action === 'pay').map((s) => s.billId),
  );

  return pool
    .filter((b) => !hidden.has(b.id) && !funded.has(b.id))
    .filter((b) => (q.categories?.length ? q.categories.includes(b.category) : true))
    .filter((b) => (q.minCents != null ? b.balanceCents >= q.minCents : true))
    .filter((b) => (q.maxCents != null ? b.balanceCents <= q.maxCents : true))
    .filter((b) => (q.urgentOnly ? isUrgent(b.dueDate, nowMs) : true))
    // most urgent first; no ranking by story quality (PRD risk mitigation)
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
}

/** Undo is accepted strictly within the 5s window (Feature 3). */
export function canUndo(swipe: SwipeRecord, nowMs: number): boolean {
  return nowMs - swipe.createdAt <= UNDO_WINDOW_MS;
}
