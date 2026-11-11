/**
 * PayConfirmSheet — PRD Feature 3/4 + Design System component.
 * MUST show final amount, fee, and biller label before any charge (AC:
 * "Pay confirmation always shows the final amount before charging").
 * Includes SafetyBanner per design system.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { PayQuote } from '@bill-swipe/shared';
import { palette, typography, layout, semantic } from '../theme/tokens';
import { formatCents } from '../utils/format';

export function SafetyBanner() {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerText}>
        Bill Swipe never holds your money. Payment goes directly to the biller through our licensed
        payment partner. If anything looks wrong, report this bill instead of paying.
      </Text>
    </View>
  );
}

interface Props {
  quote: PayQuote;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
}

export function PayConfirmSheet({ quote, onConfirm, onCancel, confirming }: Props) {
  return (
    <View style={styles.sheet} accessibilityViewIsModal>
      <Text style={styles.h2}>Confirm your payment</Text>
      <SafetyBanner />

      <Row label="Biller" value={quote.billerLabel} />
      <Row label="Bill amount" value={formatCents(quote.amountCents)} figures />
      <Row label="Platform fee" value={formatCents(quote.feeCents)} figures />
      <Row label="Total charged" value={formatCents(quote.totalCents)} figures strong />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Confirm payment of ${formatCents(quote.totalCents)}`}
        disabled={confirming}
        onPress={onConfirm}
        style={[styles.confirm, { opacity: confirming ? 0.6 : 1 }]}
      >
        <Text style={styles.confirmText}>{confirming ? 'Processing…' : 'Pay now'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel, do not pay" onPress={onCancel} hitSlop={12}>
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value, figures, strong }: { label: string; value: string; figures?: boolean; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, figures && styles.figures, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: palette.neutralLight,
    borderRadius: layout.cardRadius,
    padding: layout.pagePaddingHorizontal,
    gap: 12,
  },
  h2: { fontFamily: typography.fontFamily.headings, fontSize: typography.scale.h2, color: palette.neutralDark },
  banner: { backgroundColor: palette.secondary, borderRadius: 8, padding: 12 },
  bannerText: { color: palette.neutralDark, fontSize: typography.scale.caption },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: palette.neutralDark, fontSize: typography.scale.body },
  rowValue: { color: palette.neutralDark, fontSize: typography.scale.body },
  figures: { fontFamily: typography.fontFamily.figures, fontVariant: ['tabular-nums'] },
  strong: { fontWeight: '700' },
  confirm: {
    height: layout.buttonHeight,
    borderRadius: layout.buttonRadius,
    backgroundColor: semantic.payAction.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { color: semantic.payAction.fg, fontFamily: typography.fontFamily.headings, fontSize: typography.scale.body },
  cancel: { textAlign: 'center', color: palette.accentPass, padding: 12, fontSize: typography.scale.body },
});
