/**
 * Shared domain types for Bill Swipe (mobile + backend).
 * Field names mirror the PRD Core Data Model so client and server never drift.
 */

export const BILL_CATEGORIES = ['utility', 'medical', 'telecom', 'housing', 'other'] as const;
export type BillCategory = (typeof BILL_CATEGORIES)[number];

export const BILL_STATUSES = [
  'pending_review',
  'verified',
  'published',
  'partially_funded',
  'paid',
  'rejected',
  'withdrawn',
] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'authorized',
  'captured',
  'sent_to_biller',
  'confirmed',
  'failed',
  'reversed',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const SWIPE_ACTIONS = ['pay', 'pass', 'save'] as const;
export type SwipeAction = (typeof SWIPE_ACTIONS)[number];

export const REVIEW_DECISIONS = ['approve', 'reject', 'request_more'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** Money is always integer cents — never floats. */
export interface Money {
  amountCents: number;
  currency: 'CAD';
}

/**
 * Payer-facing projection of a bill. By construction it contains NO
 * holder name, NO full address, NO biller name (pilot) and NO unredacted image.
 * See PRD Feature 5 acceptance criteria: "No personal identifiers appear in any
 * payer-facing screen or API response."
 */
export interface PublicBillCard {
  id: string;
  category: BillCategory;
  amountCents: number;
  fundedCents: number;
  /** remaining balance shown when partially funded */
  balanceCents: number;
  dueDate: string; // ISO date
  /** city/region only, never a full address */
  region: string;
  /** optional, moderated one-line story */
  story?: string;
  /** URL to the REDACTED image only */
  redactedImageUrl?: string;
  status: Extract<BillStatus, 'published' | 'partially_funded'>;
}

export interface SwipeResult {
  billId: string;
  action: SwipeAction;
  /** undo window per PRD Feature 3: 5 seconds */
  undoWindowMs: number;
}

export interface PayQuote {
  billId: string;
  amountCents: number;
  feeCents: number;
  totalCents: number;
  /** biller CATEGORY on the confirmation sheet during pilot */
  billerLabel: string;
  expiresAt: string;
}

export interface ThankYouMessage {
  paymentId: string;
  body: string; // max 280 chars
  moderationStatus: 'pending' | 'approved' | 'rejected';
}

export interface AnalyticsEvent<T = Record<string, unknown>> {
  name: string;
  /** IDs are hashed at ingestion per PRD Analytics rule */
  hashedUserId?: string;
  properties: T;
  timestamp: string;
}
