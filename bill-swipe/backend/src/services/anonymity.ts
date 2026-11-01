/**
 * Anonymity & privacy controls — PRD Feature 5 (CRITICAL).
 * AC: "No personal identifiers appear in any payer-facing screen or API response."
 *
 * Two mechanisms:
 *   1. Handle generation: holders show as first name + last initial OR a
 *      generated handle; payers always show as a generated handle.
 *   2. A fail-closed payer projection (`toPublicBillCard`) that DROPS unknown
 *      fields rather than passing them through — so a new PII column added to
 *      the bills table can never leak into the feed by accident.
 */

const ADJ = ['quiet', 'steady', 'bright', 'kind', 'brave', 'calm', 'warm', 'good', 'true', 'free'];
const NOUN = ['river', 'maple', 'lantern', 'harbour', 'meadow', 'summit', 'cedar', 'falcon', 'aurora', 'bridge'];

/** Deterministic per-user handle (stable across sessions) from id + salt. */
export function generatePayerHandle(userId: string, salt: string): string {
  let h = 2166136261;
  const s = `${salt}:${userId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ADJ[Math.abs(h) % ADJ.length];
  const n = NOUN[Math.abs(Math.floor(h / 7)) % NOUN.length];
  const num = String(100 + (Math.abs(h) % 900));
  return `Anonymous ${a}-${n} ${num}`;
}

/** Holder display: first name + last initial only ("Maya R."), never surname. */
export function holderDisplayName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0).toUpperCase();
  return initial ? `${firstName.trim()} ${initial}.` : firstName.trim();
}

/** The generic line payers see instead of any payer identity (Feature 5). */
export const ANONYMOUS_DONOR_LINE = 'an anonymous donor';

/** Full address -> city/region only. Anything street-level is dropped. */
export function regionOnly(address: string): string {
  const parts = address.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  // Heuristic: city is typically second-to-last before the postal code/province.
  const noPostal = parts.filter((p) => !/^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(p));
  if (noPostal.length <= 1) return noPostal[0] ?? '';
  return noPostal[noPostal.length - 2];
}

const PAYER_SAFE_KEYS = new Set([
  'id', 'category', 'amountCents', 'fundedCents', 'balanceCents',
  'dueDate', 'region', 'story', 'redactedImageUrl', 'status',
]);

interface RawBillRow {
  [key: string]: unknown;
  id: string;
}

/**
 * Fail-closed projection: pick ONLY the allowlisted keys and validate them.
 * Any unexpected key (holder_id, biller_name, original_image_key, account
 * number...) is silently dropped. This is the single choke point between the
 * bills table and every payer-facing response.
 */
export function toPublicBillCard<T extends Record<string, unknown>>(row: RawBillRow): T {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    if (!PAYER_SAFE_KEYS.has(k)) continue;
    out[k] = row[k];
  }
  if (typeof out.region === 'string' && /\d+\s+\w/.test(out.region)) {
    // looks like it still contains a street number — reduce to first word/city token
    out.region = out.region.split(/\s+/).slice(-1)[0];
  }
  if (typeof out.story === 'string') {
    out.story = stripDigits(out.story); // last-resort scrub of long digit runs (acct numbers)
  }
  if (typeof out.redactedImageUrl === 'string' && /original|unredacted/i.test(out.redactedImageUrl)) {
    delete out.redactedImageUrl; // originals never leave the encrypted store
  }
  return out as T;
}

/** Remove runs of 6+ digits (account-number shaped) from free text. */
export function stripDigits(s: string): string {
  return s.replace(/\b[\d][\d\s-]{5,}\b/g, '[redacted]');
}
