/**
 * Feature 6 — delivery worker tests. Pins the 1-hour AC behavior:
 * approved notes go out inside the window, late ones still go out but are
 * reported as breaches, and nothing outside 'approved' state is deliverable.
 */
import { describe, it, expect } from 'vitest';
import { runDeliveryTick, startDeliveryLoop, type DeliveryStorePort, type DeliverySideEffects } from '../src/services/deliveryWorker';
import type { ThankYouRecord, ThankYouState } from '../src/services/thankYou';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000; // fixed clock — no real timers in tests

function rec(over: Partial<ThankYouRecord> & { id: string }): ThankYouRecord {
  return {
    paymentId: 'pay-1',
    body: 'Warmth returned to our home.',
    state: 'approved',
    createdAtMs: T0,
    deliverByMs: T0 + HOUR,
    ...over,
  };
}

function makeStore(records: ThankYouRecord[]): DeliveryStorePort & { records: ThankYouRecord[] } {
  const list = [...records];
  return {
    records: list,
    async listByState(state: ThankYouState) {
      return list.filter((r) => r.state === state).map((r) => ({ ...r }));
    },
    async casMarkDelivered(id: string) {
      const r = list.find((x) => x.id === id && x.state === 'approved');
      if (!r) return null;
      r.state = 'delivered';
      return { ...r };
    },
  };
}

function makeEffects() {
  const pushes: { paymentId: string; text: string }[] = [];
  const tracked: { paymentId: string; charCount: number }[] = [];
  const breaches: string[] = [];
  const effects: DeliverySideEffects = {
    async notifyPayer(paymentId, text) { pushes.push({ paymentId, text }); },
    trackSent(paymentId, charCount) { tracked.push({ paymentId, charCount }); },
    reportSlaBreach(r) { breaches.push(r.id); },
  };
  return { effects, pushes, tracked, breaches };
}

describe('delivery worker — Feature 6 one-hour AC', () => {
  it('delivers an approved message inside the SLA window, with push + analytics', async () => {
    const store = makeStore([rec({ id: 'a' })]);
    const { effects, pushes, tracked, breaches } = makeEffects();
    const res = await runDeliveryTick(store, effects, T0 + 60_000); // 1 min after compose
    expect(res.delivered).toEqual(['a']);
    expect(res.lateDelivered).toEqual([]);
    expect(pushes).toEqual([{ paymentId: 'pay-1', text: 'Warmth returned to our home.' }]);
    expect(tracked).toEqual([{ paymentId: 'pay-1', charCount: 'Warmth returned to our home.'.length }]);
    expect(breaches).toEqual([]);
    expect(store.records[0].state).toBe('delivered');
  });

  it('late-but-approved messages STILL deliver (dignity over SLA) and report a breach', async () => {
    const store = makeStore([rec({ id: 'b' })]);
    const { effects, breaches, pushes } = makeEffects();
    const res = await runDeliveryTick(store, effects, T0 + HOUR + 1); // 1ms past deadline
    expect(res.lateDelivered).toEqual(['b']);
    expect(breaches).toEqual(['b']);
    expect(pushes.length).toBe(1); // message still goes out
  });

  it('pending and rejected records are never deliverable, regardless of time', async () => {
    const store = makeStore([
      rec({ id: 'p', state: 'pending' }),
      rec({ id: 'r', state: 'rejected' }),
      rec({ id: 'd', state: 'delivered' }),
    ]);
    const { effects, pushes } = makeEffects();
    const res = await runDeliveryTick(store, effects, T0 + 60_000);
    expect(res.delivered).toEqual([]);
    expect(pushes).toEqual([]);
    expect(store.records.map((r) => r.state)).toEqual(['pending', 'rejected', 'delivered']);
  });

  it('double-tick cannot double-deliver (CAS guard for overlapping workers)', async () => {
    const store = makeStore([rec({ id: 'c' })]);
    const { effects, pushes } = makeEffects();
    await runDeliveryTick(store, effects, T0 + 60_000);
    const second = await runDeliveryTick(store, effects, T0 + 90_000);
    expect(second.delivered).toEqual([]);
    expect(pushes.length).toBe(1); // exactly one push ever
  });

  it('clock-skewed record (createdAt in the future) is skipped and retried later', async () => {
    const store = makeStore([rec({ id: 'f', createdAtMs: T0 + 5_000, deliverByMs: T0 + HOUR })]);
    const { effects, pushes } = makeEffects();
    const early = await runDeliveryTick(store, effects, T0); // before compose time
    expect(early.skippedNotYetDue).toBe(1);
    expect(pushes).toEqual([]);
    const later = await runDeliveryTick(store, effects, T0 + 6_000);
    expect(later.delivered).toEqual(['f']);
  });

  it('startDeliveryLoop exposes tickOnce for deterministic driving and stop() clears the timer', async () => {
    const store = makeStore([rec({ id: 'g' })]);
    const { effects, pushes } = makeEffects();
    const loop = startDeliveryLoop(store, effects, { intervalMs: 10_000, now: () => T0 + 60_000 });
    try {
      const res = await loop.tickOnce(); // uses injected clock
      expect(res.delivered).toEqual(['g']);
      expect(pushes.length).toBe(1);
    } finally {
      loop.stop();
    }
  });
});
