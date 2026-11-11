import { describe, it, expect } from 'vitest';
import { moderateText, validateThankYou, MAX_THANK_YOU_CHARS } from '@bill-swipe/shared';

// PRD Feature 6 + Content & Fraud Controls:
// "Scam pattern detection on story text (requests for money outside the app,
//  external links, contact-information leaks)" and harassment filtering.

describe('moderation — blocks per PRD fraud controls', () => {
  it.each([
    ['external link', 'pay me at http://quick-cash.example instead'],
    ['off-platform payment', 'you can Venmo me directly'],
    ['Interac e-transfer', 'just send an Interac e-transfer to help'],
    ['email leak', 'contact me at maya@example.com for details'],
    ['phone leak', 'call or text me 416-555-0123 anytime'],
  ])('blocks %s', (_name, text) => {
    expect(moderateText(text).allowed).toBe(false);
  });
});

describe('moderation — neutral content passes', () => {
  it.each([
    'Hydro got cut off last week and the reconnect fee is due Friday.',
    'My dentist quoted me after an emergency; I am short this month.',
  ])('allows: %s', (text) => {
    const r = moderateText(text);
    expect(r.allowed).toBe(true);
    expect(r.hits.filter((h) => h.severity === 'block')).toHaveLength(0);
  });
});

describe('thank-you rules', () => {
  it('enforces the 280-character limit (Feature 6)', () => {
    expect(validateThankYou('a'.repeat(MAX_THANK_YOU_CHARS)).lengthOk).toBe(true);
    expect(validateThankYou('a'.repeat(MAX_THANK_YOU_CHARS + 1)).lengthOk).toBe(false);
  });

  it('flags harassment terms for review rather than silent pass', () => {
    const r = moderateText("you're a fraud and worthless");
    expect(r.hits.some((h) => h.rule === 'harassment')).toBe(true);
  });
});
