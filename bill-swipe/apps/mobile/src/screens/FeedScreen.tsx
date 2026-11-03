/**
 * FeedScreen — composes BillCard + SwipeControls + PayConfirmSheet.
 * Gesture handling (react-native-gesture-handler) is wired in the real app;
 * here buttons are the primary path because the PRD requires a button
 * equivalent for every swipe action, and gestures must not be the only way.
 */

import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import type { PublicBillCard } from '@bill-swipe/shared';
import { api, ApiClientConfig } from '../services/apiClient';
import { feedReducer, initialFeedState } from '../state/feedStore';
import { BillCard } from '../components/BillCard';
import { SwipeControls } from '../components/SwipeControls';
import { PayConfirmSheet } from '../components/PayConfirmSheet';
import { palette, typography, layout, motion } from '../theme/tokens';

const UNDO_WINDOW_MS = 5_000;

export function FeedScreen({ cfg }: { cfg: ApiClientConfig }) {
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);
  const [quoteReq, setQuoteReq] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getFeed(cfg)
      .then((bills) => alive && dispatch({ type: 'loaded', bills }))
      .catch((e) => alive && dispatch({ type: 'failed', error: String(e) }));
    return () => { alive = false; };
  }, [cfg]);

  const card: PublicBillCard | undefined = state.stack[state.index];

  async function act(action: 'pay' | 'pass' | 'save') {
    if (!card) return;
    if (action === 'pay') return setQuoteReq(true); // confirmation sheet BEFORE any charge
    await api.swipe(cfg, card.id, action);
    dispatch({ type: 'swiped', billId: card.id, action, at: Date.now() });
    showUndo();
  }

  function showUndo() {
    setUndoVisible(true);
    setTimeout(() => setUndoVisible(false), UNDO_WINDOW_MS); // 5s per PRD Feature 3
  }

  async function undo() {
    if (!state.lastSwipe) return;
    dispatch({ type: 'undo', at: Date.now(), undoWindowMs: UNDO_WINDOW_MS });
    setUndoVisible(false);
  }

  if (state.loading) return <ActivityIndicator style={{ flex: 1 }} color={palette.primary} />;
  if (!card) {
    return (
      <View style={styles.empty}>
        {/* Neutral copy: no judgment framing on empty/pass states (PRD positioning note) */}
        <Text style={styles.emptyText}>No bills right now. New verified bills appear here.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <BillCard bill={card} onPressImage={() => {/* opens full redacted image viewer */}} />
      {undoVisible && (
        <Text accessibilityRole="alert" style={styles.undoRow}>
          <Text onPress={undo} style={styles.undoLink}>Undo</Text>
        </Text>
      )}
      <SwipeControls
        onPay={() => act('pay')}
        onPass={() => act('pass')}
        onSave={() => act('save')}
      />
      {quoteReq && card && (
        <AsyncQuote cfg={cfg} bill={card} onCancel={() => setQuoteReq(false)}
          onPaid={(amount) => {
            setQuoteReq(false);
            dispatch({ type: 'swiped', billId: card.id, action: 'pay', at: Date.now() });
          }} />
      )}
    </ScrollView>
  );
}

function AsyncQuote({ cfg, bill, onCancel, onPaid }: {
  cfg: ApiClientConfig; bill: PublicBillCard; onCancel: () => void; onPaid: (cents: number) => void;
}) {
  const [quote, setQuote] = useState< Awaited<ReturnType<typeof api.quote>> | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { api.quote(cfg, bill.id).then(setQuote).catch(onCancel); }, [cfg, bill.id]);
  if (!quote) return null;
  return (
    <PayConfirmSheet
      quote={quote}
      confirming={confirming}
      onCancel={onCancel}
      onConfirm={async () => {
        setConfirming(true);
        try {
          await api.pay(cfg, bill.id, quote.amountCents);
          onPaid(quote.totalCents);
        } finally {
          setConfirming(false);
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: layout.pagePaddingHorizontal, gap: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: palette.neutralDark, fontSize: typography.scale.body },
  undoRow: { textAlign: 'center', color: palette.accentPass, minHeight: 24 },
  undoLink: { color: palette.primary, textDecorationLine: 'underline', paddingHorizontal: 12, paddingVertical: 8 },
});
