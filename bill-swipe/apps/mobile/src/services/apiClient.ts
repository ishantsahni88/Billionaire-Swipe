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
  getFeed: (cfg: ApiClientConfig, q = '') => req<PublicBillCard[]>(cfg, 'GET', `/v1/feed${q}`),
  swipe: (cfg: ApiClientConfig, billId: string, action: SwipeAction) =>
    req<{ undoExpiresAt: string }>(cfg, 'POST', `/v1/bills/${billId}/swipe`, { action }),
  undo: (cfg: ApiClientConfig, swipeId: string) => req<void>(cfg, 'POST', `/v1/swipes/${swipeId}/undo`),
  quote: (cfg: ApiClientConfig, billId: string) => req<PayQuote>(cfg, 'POST', `/v1/bills/${billId}/quote`),
  pay: (cfg: ApiClientConfig, billId: string, amountCents: number) =>
    req<{ paymentId: string; receiptUrl: string }>(cfg, 'POST', '/v1/payments', { billId, amountCents }),
  report: (cfg: ApiClientConfig, billId: string, reason: string) =>
    req<void>(cfg, 'POST', `/v1/bills/${billId}/report`, { reason }),
  dashboard: (cfg: ApiClientConfig) =>
    req<{ totalFundedCents: number; billsFunded: number; categories: string[] }>(cfg, 'GET', '/v1/payer/dashboard'),
};
