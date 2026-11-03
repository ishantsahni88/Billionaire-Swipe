/**
 * StatusTimeline — Uploaded → Verified → Funded → Paid (Design System component).
 * Copy stays neutral and factual; no gamification (PRD risk mitigation).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { palette, typography, layout } from '../theme/tokens';

export type Stage = 'uploaded' | 'verified' | 'funded' | 'paid';
const ORDER: Stage[] = ['uploaded', 'verified', 'funded', 'paid'];
const LABEL: Record<Stage, string> = {
  uploaded: 'Uploaded',
  verified: 'Verified',
  funded: 'Funded',
  paid: 'Paid',
};

export function StatusTimeline({ current, rejected }: { current: Stage; rejected?: boolean }) {
  const idx = ORDER.indexOf(current);
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`Status: ${LABEL[current]}${rejected ? ', not approved' : ''}`}>
      {ORDER.map((s, i) => (
        <View key={s} style={styles.step}>
          <View style={[styles.dot, i <= idx && !rejected ? styles.dotDone : null]} />
          <Text style={[styles.label, i <= idx ? styles.labelDone : null]}>{LABEL[s]}</Text>
        </View>
      ))}
      {rejected && <Text style={styles.rejected}>This bill wasn’t approved. You can upload again or ask for help.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: layout.pagePaddingHorizontal },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: palette.accentPass },
  dotDone: { backgroundColor: palette.primary, borderColor: palette.primary },
  label: { fontSize: typography.scale.caption, color: palette.accentPass },
  labelDone: { color: palette.neutralDark, fontFamily: typography.fontFamily.headings },
  rejected: { color: palette.error, fontSize: typography.scale.caption },
});
