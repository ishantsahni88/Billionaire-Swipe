/**
 * Ops verification console service — PRD Persona 3 (The Verifier) and the
 * "ops verification console" deliverable in Launch Plan months 3–4.
 *
 * Provides: a work queue ordered by SLA risk (oldest pending first, urgent
 * bills boosted), the checklist schema from Feature 2, decision recording into
 * verification_reviews, and the flag rule from Content & Fraud Controls:
 * "Bill-holder accounts flagged after two rejected submissions for review."
 */

import type { ReviewDecision } from '@bill-swipe/shared';
import { REVIEW_CHECKLIST, autoScreen, decideReview, type BillSubmission, type ChecklistItem } from './verification.js';

export interface QueueItem {
  billId: string;
  submittedAt: number; // epoch ms
  amountCents: number;
  flags: string[];
  requiresSecondaryDoc: boolean;
  /** true once 24h have elapsed without a decision — breaches Feature 2 AC */
  slaBreached: boolean;
}

export const REVIEW_SLA_MS = 24 * 60 * 60_000; // decision within 24 hours (90% target)

/** Build the reviewer queue: oldest first so the 24h SLA is protected; ties broken by urgency of due date. */
export function buildQueue(
  subs: { sub: BillSubmission; submittedAt: number; dueDateMs: number }[],
  prior: BillSubmission[],
  nowMs: number,
): QueueItem[] {
  return subs
    .map(({ sub, submittedAt, dueDateMs }) => {
      const screen = autoScreen(sub, prior);
      return {
        billId: sub.id,
        submittedAt,
        amountCents: sub.declaredAmountCents,
        flags: screen.flags,
        requiresSecondaryDoc: screen.requiresSecondaryDoc,
        slaBreached: nowMs - submittedAt > REVIEW_SLA_MS,
        _due: dueDateMs,
      };
    })
    .sort((a, b) => a.submittedAt - b.submittedAt || a._due - b._due)
    .map(({ _due, ...q }) => q);
}

export interface RecordedReview {
  id: string;
  billId: string;
  reviewerId: string;
  decision: ReviewDecision;
  checklist: Record<ChecklistItem, boolean>;
  notes?: string;
  createdAt: string;
}

/**
 * Reviewers CANNOT record an approve decision unless every checklist item is
 * checked — mirrors the DB constraint we'll add (checklist JSONB completeness).
 */
export function recordReview(opts: {
  billId: string;
  reviewerId: string;
  checklist: Partial<Record<ChecklistItem, boolean>>;
  secondaryDocProvided: boolean;
  amountCents: number;
  hardFlags: string[];
  notes?: string;
}): { review: RecordedReview; decision: ReviewDecision } {
  for (const item of REVIEW_CHECKLIST) {
    if (!(item in opts.checklist)) {
      throw new Error(`incomplete checklist: missing ${item}`);
    }
  }
  const decision = decideReview({
    checklist: opts.checklist as Record<ChecklistItem, boolean>,
    secondaryDocProvided: opts.secondaryDocProvided,
    amountCents: opts.amountCents,
    hardFlags: opts.hardFlags,
  });
  return {
    decision,
    review: {
      id: crypto.randomUUID(),
      billId: opts.billId,
      reviewerId: opts.reviewerId,
      decision,
      checklist: opts.checklist as Record<ChecklistItem, boolean>,
      notes: opts.notes,
      createdAt: new Date().toISOString(),
    },
  };
}

/** Content & Fraud Controls: flag holder account after TWO rejected submissions. */
export const REJECT_FLAG_THRESHOLD = 2;

export function shouldFlagHolder(pastDecisions: ReviewDecision[]): boolean {
  return pastDecisions.filter((d) => d === 'reject').length >= REJECT_FLAG_THRESHOLD;
}
