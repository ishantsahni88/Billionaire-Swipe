/**
 * BillCard — PRD Feature 3 card + Design System "BillCard" component.
 * Shows ONLY: category chip, amount, days until due/disconnection, optional
 * one-line story, redacted bill image on tap. Never biller name (pilot),
 * never holder identity, never full address (Feature 5).
 * Amounts use tabular figures so they line up on the card.
 */

import React from 'react';
import { Pressable, Text, View, Image, StyleSheet } from 'react-native';
import type { PublicBillCard } from '@bill-swipe/shared';
import { palette, typography, layout, motion } from '../theme/tokens';
import { formatCents, daysUntilLabel } from '../utils/format';

interface Props {
  bill: PublicBillCard;
  onPressImage: (billId: string) => void;
}

export function BillCard({ bill, onPressImage }: Props) {
  const urgent = new Date(bill.dueDate).getTime() - Date.now() <= 7 * 86_400_000;
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={
        `Bill: ${bill.category}, ${formatCents(bill.balanceCents)}, ${daysUntilLabel(bill.dueDate)}.` +
        (bill.story ? ` Story: ${bill.story}` : '')
      }
    >
      <View style={styles.chipRow}>
        <Text style={styles.chip}>{CATEGORY_LABEL[bill.category]}</Text>
        <Text style={[styles.due, urgent && styles.dueUrgent]}>{daysUntilLabel(bill.dueDate)}</Text>
      </View>

      <Text style={styles.amount}>{formatCents(bill.balanceCents)}</Text>
      {bill.fundedCents > 0 && (
        <Text style={styles.partial}>
          {formatCents(bill.fundedCents)} already funded — {formatCents(bill.balanceCents)} remaining
        </Text>
      )}

      {!!bill.story && <Text style={styles.story} numberOfLines={2}>{bill.story}</Text>}

      <Text style={styles.region}>{bill.region}</Text>

      {!!bill.redactedImageUrl && (
        <Pressable
          onPress={() => onPressImage(bill.id)}
          accessibilityRole="button"
          accessibilityLabel="View redacted bill image"
          hitSlop={12}
        >
          <Image source={{ uri: bill.redactedImageUrl }} style={styles.thumb} resizeMode="contain" />
        </Pressable>
      )}
    </View>
  );
}

const CATEGORY_LABEL: Record<PublicBillCard['category'], string> = {
  utility: 'Utilities',
  medical: 'Medical',
  telecom: 'Telecom',
  housing: 'Housing',
  other: 'Other',
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.neutralLight,
    borderRadius: layout.cardRadius,
    padding: layout.pagePaddingHorizontal,
    gap: 8,
  },
  chipRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: {
    color: '#FFFFFF',
    backgroundColor: palette.primary,
    fontSize: typography.scale.caption,
    fontFamily: typography.fontFamily.headings,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  due: { color: palette.neutralDark, fontSize: typography.scale.caption },
  dueUrgent: { color: palette.warning, fontWeight: '600' },
  amount: {
    fontFamily: typography.fontFamily.figures,
    fontSize: 34,
    color: palette.neutralDark,
    fontVariant: ['tabular-nums'],
  },
  partial: { color: palette.neutralDark, fontSize: typography.scale.caption },
  story: { fontSize: typography.scale.body, color: palette.neutralDark },
  region: { fontSize: typography.scale.caption, color: palette.accentPass },
  thumb: { width: '100%', height: 120, borderRadius: 8, backgroundColor: palette.secondary },
});
