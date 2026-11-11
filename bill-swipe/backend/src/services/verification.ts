/**
 * Verification pipeline — PRD Feature 2.
 * Automated pre-screening + human checklist, per the PRD requirements:
 *   - OCR extraction (biller name, amount, due date, holder initials)
 *   - biller allowlist cross-check
 *   - duplicate detection (exact bill hash OR same biller+amount+date)
 *   - secondary document required for bills over $500
 *   - ops checklist decision: approve | reject | request_more
 */

export interface OcrResult {
  billerName: string;
  amountCents: number;
  dueDate: string; // ISO
  accountHolderInitials: string; // e.g. "J.M.K" — never the full name downstream
  hasPaidStamp: boolean;
  detectedAccountNumber?: string; // used only to verify redaction ran; never persisted payer-side
}

export interface BillSubmission {
  id: string;
  billHash: string; // sha-256 of normalized image bytes
  ocr: OcrResult;
  declaredAmountCents: number;
  holderInitials: string;
  hasSecondaryDocument: boolean;
}

export const BILLER_ALLOWLIST: ReadonlySet<string> = new Set([
  'toronto hydro',
  'enbridge gas',
  'hydro one',
  'bell canada',
  'rogers',
  'telus',
  'queens park clinic',
  'dentalcare plus',
]);

export const SECONDARY_DOC_THRESHOLD_CENTS = 50_000; // $500 per PRD Feature 2

const dupFingerprint = (o: { billerName: string; amountCents: number; dueDate: string }) =>
  `${o.billerName.trim().toLowerCase()}|${o.amountCents}|${o.dueDate}`;

export function isDuplicate(sub: BillSubmission, prior: BillSubmission[]): boolean {
  if (prior.some((p) => p.billHash === sub.billHash)) return true; // exact re-upload -> must be 100%
  return prior.some((p) => dupFingerprint(p.ocr) === dupFingerprint(sub.ocr));
}

export interface AutoScreenResult {
  flags: string[];
  requiresSecondaryDoc: boolean;
}

export function autoScreen(sub: BillSubmission, prior: BillSubmission[]): AutoScreenResult {
  const flags: string[] = [];
  const billerKey = sub.ocr.billerName.trim().toLowerCase();
  if (!BILLER_ALLOWLIST.has(billerKey)) flags.push('biller_not_allowlisted');
  if (sub.ocr.hasPaidStamp) flags.push('paid_stamp_visible');
  if (Math.abs(sub.ocr.amountCents - sub.declaredAmountCents) > 100) flags.push('amount_mismatch');
  if (isDuplicate(sub, prior)) flags.push('possible_duplicate');
  if (sub.ocr.accountHolderInitials.replace(/[^a-z]/gi, '') !==
      sub.holderInitials.replace(/[^a-z]/gi, '')) flags.push('holder_initials_mismatch');
  return {
    flags,
    requiresSecondaryDoc: sub.declaredAmountCents > SECONDARY_DOC_THRESHOLD_CENTS,
  };
}

/** The ops reviewer checklist — PRD Feature 2 requirement list, verbatim in order. */
export const REVIEW_CHECKLIST = [
  'biller_legitimate',
  'amount_matches',
  'no_paid_stamp',
  'identity_consistent',
] as const;
export type ChecklistItem = (typeof REVIEW_CHECKLIST)[number];

export interface ReviewDecisionInput {
  checklist: Record<ChecklistItem, boolean>;
  secondaryDocProvided: boolean;
  amountCents: number;
  hardFlags: string[]; // blocking flags from auto-screen
}

export type ReviewDecision = 'approve' | 'reject' | 'request_more';

export function decideReview(input: ReviewDecisionInput): ReviewDecision {
  const allChecked = REVIEW_CHECKLIST.every((k) => input.checklist[k]);
  if (input.hardFlags.includes('paid_stamp_visible')) return 'reject';
  if (input.hardFlags.includes('possible_duplicate')) return 'reject';
  if (input.amountCents > SECONDARY_DOC_THRESHOLD_CENTS && !input.secondaryDocProvided) {
    return 'request_more';
  }
  return allChecked ? 'approve' : 'request_more';
}
