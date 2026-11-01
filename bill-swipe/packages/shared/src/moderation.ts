/**
 * Story & thank-you moderation — mirrors PRD "Content and Fraud Controls":
 * scam pattern detection on story text (requests for money outside the app,
 * external links, contact-information leaks) and harassment filtering.
 * Target: catches 90%+ of harassment and contact-info leaks (Feature 6 AC).
 */

export interface ModerationHit {
  rule: string;
  severity: 'block' | 'flag';
  snippet: string;
}

export interface ModerationResult {
  allowed: boolean;
  /** True when soft flags exist: message may be stored but NOT auto-delivered
   *  without an ops verdict (Feature 6 review path). */
  needsReview: boolean;
  hits: ModerationHit[];
}

const URL_RE = /(https?:\/\/|www\.)\S+/i;
const OFF_PLATFORM_PAY_RE =
  /\b(venmo|paypal\.me|cash\s?app|interac\s?(e-?transfer|send)?|wire\s?(the\s?)?(money|funds)|zelle|gift\s?cards?\s?(for\s?me)?)\b/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const ADDRESS_RE = /\b\d{2,6}\s+[A-Za-z'\-.]+\s+(?:st(?:reet)?|ave(?:nue)?|rd|road|blvd|dr|drive|ln|lane|way|ct|court)\b/i;

const HARASSMENT_TERMS = [
  'scammer', 'fraud', 'fake', 'liar', 'deserve', 'worthless', 'lazy', 'addict',
  'stop begging', 'not real', 'photo$hop',
];

export const MAX_THANK_YOU_CHARS = 280;

export function moderateText(text: string): ModerationResult {
  const hits: ModerationHit[] = [];
  const push = (rule: string, severity: 'block' | 'flag', snippet: string) =>
    hits.push({ rule, severity, snippet });

  if (URL_RE.test(text)) push('external_link', 'block', text.match(URL_RE)![0]);
  if (OFF_PLATFORM_PAY_RE.test(text)) push('off_platform_payment', 'block', text);
  if (EMAIL_RE.test(text)) push('contact_info_email', 'block', text.match(EMAIL_RE)![0]);
  if (PHONE_RE.test(text)) push('contact_info_phone', 'block', text.match(PHONE_RE)![0]);
  if (ADDRESS_RE.test(text)) push('contact_info_address', 'flag', text.match(ADDRESS_RE)![0]);
  for (const term of HARASSMENT_TERMS) {
    if (new RegExp(`\\b${term}\\b`, 'i').test(text)) push('harassment', 'flag', term);
  }

  const blocked = hits.some((h) => h.severity === 'block');
  // Any soft flag keeps the message ALLOWED but routes it to the ops review
  // queue (state 'pending' in services/thankYou.ts). Feature 6 AC targets
  // "90%+ of harassment and contact-info leaks" caught before delivery —
  // a single address leak or one harassment term must never auto-deliver.
  const hasFlags = hits.some((h) => h.severity === 'flag');
  return { allowed: !blocked, hits, needsReview: hasFlags };
}

export function validateThankYou(body: string): ModerationResult & { lengthOk: boolean } {
  return { ...moderateText(body), lengthOk: body.length <= MAX_THANK_YOU_CHARS };
}
