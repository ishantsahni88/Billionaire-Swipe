/**
 * Feature 6 delivery worker — enforces the "messages delivered within 1 hour
 * of payment confirmation" acceptance criterion.
 *
 * Design notes:
 *  - The SLA window is computed at COMPOSE time (deliverByMs = createdAt + PT1H)
 *    and travels with the record, so this worker never re-derives deadlines.
 *  - Only records in state 'approved' are eligible; pending (awaiting an ops
 *    verdict) and rejected notes can never be delivered from here — that
 *    guarantee lives in the thankYou service state machine, not in timing.
 *  - Late-but-approved messages still go out after their deadline (the human
 *    moment matters more than the SLA), but each miss is REPORTED so ops can
 *    see backlog breaching the 1-hour AC.
 *  - Delivery side effects (push via APNs/FCM, analytics event) are injected
 *    through a narrow port so this module stays pure and testable.
 */
import { markDelivered, type ThankYouRecord, type ThankYouState } from './thankYou';

export interface DeliverableThankYou extends ThankYouRecord {}

export interface DeliveryStorePort {
  /** All records currently in `state` (backed by SQL in production). */
  listByState(state: ThankYouState): Promise<DeliverableThankYou[]>;
  /** Compare-and-set: only flips approved -> delivered if still approved.
   *  Returns the delivered record, or null when someone else got there first. */
  casMarkDelivered(id: string): Promise<DeliverableThankYou | null>;
}

export interface DeliverySideEffects {
  /** Push notification to the PAYER only (Feature 5: identity-safe transport). */
  notifyPayer(paymentId: string, text: string): Promise<void>;
  /** Analytics: `thank_you_sent` per the PRD tracking table. */
  trackSent(paymentId: string, charCount: number): void;
  /** Ops-visible signal that the 1-hour AC was missed for this message. */
  reportSlaBreach?(record: DeliverableThankYou, nowMs: number): void;
}

export interface DeliveryRunResult {
  delivered: string[];        // record ids delivered inside the SLA window
  lateDelivered: string[];    // delivered after deliverByMs (AC breach, reported)
  skippedNotYetDue: number;   // defensive: eligibleForDelivery returned false
}

/** One worker tick: fetch approved notes, deliver what's due, report breaches. */
export async function runDeliveryTick(
  store: DeliveryStorePort,
  effects: DeliverySideEffects,
  nowMs: number,
): Promise<DeliveryRunResult> {
  const result: DeliveryRunResult = { delivered: [], lateDelivered: [], skippedNotYetDue: 0 };
  const candidates = await store.listByState('approved');

  for (const rec of candidates) {
    // Late-but-approved messages must STILL go out (dignity over SLA), so the
    // only hard gate is "not before compose time". Past-deadline records are
    // flagged as AC breaches but delivered anyway.
    if (nowMs < rec.createdAtMs) {
      result.skippedNotYetDue++; // clock skew — retry next tick
      continue;
    }
    // CAS guards against double-delivery if two worker instances overlap.
    const flipped = await store.casMarkDelivered(rec.id);
    if (!flipped) continue;
    // Sanity: the port must hand back a record the state machine accepts.
    markDelivered(rec); // throws if 'approved' invariant was violated upstream

    if (nowMs > rec.deliverByMs) {
      result.lateDelivered.push(rec.id);
      effects.reportSlaBreach?.(rec, nowMs);
    } else {
      result.delivered.push(rec.id);
    }
    await effects.notifyPayer(rec.paymentId, rec.body);
    effects.trackSent(rec.paymentId, rec.body.length);
  }
  return result;
}

/** Minimal setInterval driver. In production this becomes a cron/queue consumer;
 *  exported separately so tests never need real timers. */
export function startDeliveryLoop(
  store: DeliveryStorePort,
  effects: DeliverySideEffects,
  opts: { intervalMs?: number; now?: () => number } = {},
): { stop: () => void; tickOnce: (nowMs?: number) => Promise<DeliveryRunResult> } {
  const intervalMs = opts.intervalMs ?? 30_000; // AC headroom: 1h SLA, 30s poll
  const now = opts.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tickOnce = (nowMs?: number) => runDeliveryTick(store, effects, nowMs ?? now());
  timer = setInterval(() => { void tickOnce().catch(() => {/* surfaced via metrics in prod */}); }, intervalMs);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref(); // don't hold the process open
  return {
    stop: () => { if (timer) clearInterval(timer); timer = null; },
    tickOnce,
  };
}
