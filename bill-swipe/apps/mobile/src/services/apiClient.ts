/**
 * API client (mobile side) — implements packages/shared/src/api.ts contract.
 * NOTE: payments are gated behind the LEGAL_HOLD flag until counsel signs off
 * on the money-transmission structure (PRD Dependencies — gating item).
 */

import type { PublicBillCard, PayQuote, SwipeAction } from '@bill-swipe/shared';

export interface ApiClientConfig {
  baseUrl: string; // e.g. https://api.billswipe.ca (Canadian region — PRD hosting)
  accessToken: string;
}

async function req<T>(cfg: ApiClientConfig, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(cfg.baseUrl + path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.accessToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`API ${res.status}`), { status: res.status });
  return res.json() as Promise<T>;
}

export const api = {
  // ---- Auth: passwordless OTP (Tech Stack) --------------------------------
  otpStart: (cfg: ApiClientConfig, destination: string, channel: 'phone' | 'email', dob?: string) =>
    req<{ challengeId: string; devCode?: string }>(cfg, 'POST', '/v1/auth/otp/start', { destination, channel, dob }),
  otpVerify: (cfg: ApiClientConfig, challengeId: string, code: string) =>
    req<{ verified: boolean }>(cfg, 'POST', '/v1/auth/otp/verify', { challengeId, code }),

  // ---- Feature 1: upload / redact / submit ---------------------------------
  uploadBill: (cfg: ApiClientConfig, fileBase64: string, ocrWords?: unknown[]) =>
    req<{ billId: string; stage: string; redactedImageUrl: string; appliedRegions: unknown[]; detectedKinds: string[] }>(
      cfg, 'POST', '/v1/bills', { fileBase64, ocrWords: ocrWords ?? [] }),
  adjustRedaction: (cfg: ApiClientConfig, billId: string, added: unknown[]) =>
    req<{ stage: string; appliedRegions: unknown[] }>(cfg, 'PATCH', `/v1/bills/${billId}/redaction`, { added }),
  submitBill: (cfg: ApiClientConfig, billId: string) =>
    req<{ stage: string; message: string }>(cfg, 'POST', `/v1/bills/${billId}/submit`),
  billStatus: (cfg: ApiClientConfig, billId: string) =>
    req<{ billId: string; status: string; stages: { key: string; done: boolean }[] }>(cfg, 'GET', `/v1/bills/${billId}/status`),

  // ---- Feed & swipes --------------------------------------------------------
  getFeed: (cfg: ApiClientConfig, q = '') => req<PublicBillCard[]>(cfg, 'GET', `/v1/feed${q}`),
  swipe: (cfg: ApiClientConfig, billId: string, action: SwipeAction) =>
    req<{ undoExpiresAt: string }>(cfg, 'POST', `/v1/bills/${billId}/swipe`, { action }),
  undo: (cfg: ApiClientConfig, swipeId: string) => req<void>(cfg, 'POST', `/v1/swipes/${swipeId}/undo`),
  quote: (cfg: ApiClientConfig, billId: string) => req<PayQuote>(cfg, 'POST', `/v1/bills/${billId}/quote`),
  pay: (cfg: ApiClientConfig, billId: string, amountCents: number) =>
    req<{ paymentId: string; receiptUrl: string }>(cfg, 'POST', '/v1/payments', { billId, amountCents }),
  thankyou: (cfg: ApiClientConfig, paymentId: string, body: string) =>
    req<{ status: string }>(cfg, 'POST', `/v1/payments/${paymentId}/thankyou`, { body }),
  report: (cfg: ApiClientConfig, billId: string, reason: string) =>
    req<void>(cfg, 'POST', `/v1/bills/${billId}/report`, { reason }),
  dashboard: (cfg: ApiClientConfig) =>
    req<{ totalFundedCents: number; billsFunded: number; categories: string[] }>(cfg, 'GET', '/v1/payer/dashboard'),
  // ---- User Flow 4: disputes ------------------------------------------------
  // NOTE: type enum mirrors backend routes exactly (packages/shared/src/api.ts).
  openDispute: (cfg: ApiClientConfig, billId: string, type: 'wrong_biller' | 'bill_already_paid' | 'scam' | 'charged_wrong_amount' | 'other', paymentId?: string) =>
    req<{ id: string; state: string; dueBy: string }>(cfg, 'POST', '/v1/disputes', { billId, type, paymentId }),
};
