/**
 * OTP auth service — PRD Tech Stack: "Passwordless login (phone or email OTP)"
 * and Security: "Account lockout after repeated failed OTP attempts".
 * Also enforces: minors must be 18+ (Compliance § Minors) and payer KYC gate
 * before any payment (Compliance § Payer KYC).
 */

export type OtpChannel = 'phone' | 'email';

export interface OtpChallenge {
  destination: string; // e164 phone or email
  channel: OtpChannel;
  codeHash: string; // sha256(salt:code) — plaintext code only in the SMS/email payload
  attempts: number;
  lockedUntil?: number; // epoch ms
  expiresAt: number; // epoch ms — codes are short-lived
  consumed: boolean;
}

export const OTP_TTL_MS = 5 * 60_000; // 5 minutes
export const MAX_OTP_ATTEMPTS = 5; // then lockout
export const LOCKOUT_MS = 15 * 60_000;
export const MIN_AGE_YEARS = 18; // enforced at sign-up per PRD Compliance

import { createHash, randomInt } from 'crypto';

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

export function createChallenge(destination: string, channel: OtpChannel, code: string, salt: string, nowMs: number): OtpChallenge {
  return {
    destination,
    channel,
    codeHash: hashOtp(code, salt),
    attempts: 0,
    expiresAt: nowMs + OTP_TTL_MS,
    consumed: false,
  };
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'locked' | 'mismatch' | 'already_used' };

/** Pure state transition so tests can drive the full lockout sequence. */
export function verifyOtp(ch: OtpChallenge, inputCode: string, salt: string, nowMs: number): { next: OtpChallenge; outcome: VerifyOutcome } {
  if (ch.consumed) return { next: ch, outcome: { ok: false, reason: 'already_used' } };
  if (ch.lockedUntil && nowMs < ch.lockedUntil) return { next: ch, outcome: { ok: false, reason: 'locked' } };
  if (nowMs > ch.expiresAt) return { next: ch, outcome: { ok: false, reason: 'expired' } };

  const match = hashOtp(inputCode, salt) === ch.codeHash;
  if (!match) {
    const attempts = ch.attempts + 1;
    const locked = attempts >= MAX_OTP_ATTEMPTS;
    return {
      next: { ...ch, attempts, lockedUntil: locked ? nowMs + LOCKOUT_MS : undefined },
      outcome: { ok: false, reason: locked ? 'locked' : 'mismatch' },
    };
  }
  return { next: { ...ch, consumed: true }, outcome: { ok: true } };
}

/** PRD Compliance: bill-holders and payers must be 18+, enforced at sign-up. */
export function isOfAge(dobIso: string, nowMs: number = Date.now()): boolean {
  const dob = Date.parse(dobIso);
  if (Number.isNaN(dob)) return false;
  const ageYears = (nowMs - dob) / (365.25 * 86_400_000);
  return ageYears >= MIN_AGE_YEARS;
}

/**
 * Payers cannot reach the payment routes until KYC (identity + sanctions
 * screening via the partner's provider) is complete. Holders do not need KYC
 * to upload — verification of the BILL is separate from verification of the PERSON.
 */
export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected';

export function canPay(kyc: KycStatus): boolean {
  return kyc === 'approved';
}
