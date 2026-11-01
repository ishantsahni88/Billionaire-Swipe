import { describe, it, expect } from 'vitest';
import { buildFeed, canUndo, isUrgent, UNDO_WINDOW_MS, PASS_COOLDOWN_DAYS, type SwipeRecord } from '../src/services/feed';
import type { PublicBillCard } from '../packages/shared/src/types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1); // Nov 1 2026

const card = (over: Partial<PublicBillCard> = {}): PublicBillCard => ({
  id: crypto.randomUUID(),
  category: 'utility',
  amountCents: 20_000,
  fundedCents: 0,
  balanceCents: 20_000,
  dueDate: new Date(NOW + 10 * DAY).toISOString().slice(0, 10),
  region: 'Toronto',
  status: 'published',
  ...over,
});

describe('Feature 3 — feed rules', () => {
  it('hides bills passed in the last 30 days but re-shows them after', () => {
    const b = card();
    const recent: SwipeRecord[] = [{ payerId: 'p1', billId: b.id, action: 'pass', createdAt: NOW - 29 * DAY }];
    expect(buildFeed([b], recent, 'p1', {}, NOW)).toHaveLength(0);
    const stale: SwipeRecord[] = [{ payerId: 'p1', billId: b.id, action: 'pass', createdAt: NOW - (PASS_COOLDOWN_DAYS + 1) * DAY }];
    expect(buildFeed([b], stale, 'p1', {}, NOW)).toHaveLength(1);
  });

  it('applies category, amount-range and urgency filters', () => {
    const pool = [
      card({ category: 'medical', balanceCents: 5_000, dueDate: new Date(NOW + 3 * DAY).toISOString().slice(0, 10) }),
      card({ category: 'utility', balanceCents: 40_000, dueDate: new Date(NOW + 30 * DAY).toISOString().slice(0, 10) }),
    ];
    expect(buildFeed(pool, [], 'p1', { categories: ['medical'] }, NOW)).toHaveLength(1);
    expect(buildFeed(pool, [], 'p1', { maxCents: 10_000 }, NOW)).toHaveLength(1);
    expect(buildFeed(pool, [], 'p1', { urgentOnly: true }, NOW)).toHaveLength(1);
  });

  it('orders by most urgent first — never by story quality (PRD risk mitigation)', () => {
    const soon = card({ dueDate: new Date(NOW + 2 * DAY).toISOString().slice(0, 10), story: 'meh' });
    const late = card({ dueDate: new Date(NOW + 20 * DAY).toISOString().slice(0, 10), story: 'award-winning prose' });
    const feed = buildFeed([late, soon], [], 'p1', {}, NOW);
    expect(feed[0].id).toBe(soon.id);
  });

  it('undo is valid within 5 seconds and rejected after', () => {
    expect(UNDO_WINDOW_MS).toBe(5_000);
    const s: SwipeRecord = { payerId: 'p', billId: 'b', action: 'pass', createdAt: NOW };
    expect(canUndo(s, NOW + 4_999)).toBe(true);
    expect(canUndo(s, NOW + 5_001)).toBe(false);
  });

  it('urgency window matches "due within 7 days"', () => {
    expect(isUrgent(new Date(NOW + 6.5 * DAY).toISOString(), NOW)).toBe(true);
    expect(isUrgent(new Date(NOW + 8 * DAY).toISOString(), NOW)).toBe(false);
  });
});
