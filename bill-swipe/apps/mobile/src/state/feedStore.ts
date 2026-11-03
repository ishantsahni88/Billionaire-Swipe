/**
 * Feed state machine (mobile). Pure and testable — the UI layer only dispatches.
 * Implements PRD Feature 3 behaviours: undo within 5s, pass cooldown handled
 * server-side, "consider later" saves, filters.
 */

import type { PublicBillCard, SwipeAction } from '@bill-swipe/shared';

export interface FeedState {
  stack: PublicBillCard[];
  index: number;
  lastSwipe?: { billId: string; action: SwipeAction; at: number };
  loading: boolean;
  error?: string;
}

export const initialFeedState: FeedState = { stack: [], index: 0, loading: true };

export type FeedEvent =
  | { type: 'loaded'; bills: PublicBillCard[] }
  | { type: 'swiped'; billId: string; action: SwipeAction; at: number }
  | { type: 'undo'; at: number; undoWindowMs: number }
  | { type: 'failed'; error: string };

export function feedReducer(state: FeedState, e: FeedEvent): FeedState {
  switch (e.type) {
    case 'loaded':
      return { ...state, stack: e.bills, index: 0, loading: false };
    case 'swiped':
      return { ...state, index: state.index + 1, lastSwipe: { billId: e.billId, action: e.action, at: e.at } };
    case 'undo': {
      if (!state.lastSwipe || e.at - state.lastSwipe.at > e.undoWindowMs) return state; // window expired
      return { ...state, index: Math.max(0, state.index - 1), lastSwipe: undefined };
    }
    case 'failed':
      return { ...state, loading: false, error: e.error };
  }
}
