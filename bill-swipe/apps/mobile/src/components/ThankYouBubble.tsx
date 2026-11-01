/**
 * ThankYouBubble — Design System component (PRD Feature 6).
 *
 * Renders the short, moderated thank-you message from a bill-holder as it is
 * shown to the payer. Rules encoded here and in the backend:
 *   - max 280 characters (shared MAX_THANK_YOU_CHARS) — enforced pre-delivery
 *   - already passed automated moderation before this renders; the component
 *     still refuses to render unmoderated text (fail-closed UI)
 *   - no reply affordance anywhere: MVP keeps the exchange one-directional to
 *     avoid harassment (Feature 6 requirement)
 *   - sender stays anonymous: "a Bill Swipe recipient", never a name/handle
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { palette, typography, layout, motion } from '../theme/tokens';
import { MAX_THANK_YOU_CHARS } from '@bill-swipe/shared';

export type ModerationStatus = 'pending' | 'approved' | 'rejected';

export interface ThankYouBubbleProps {
  /** Message body; MUST be moderation-approved server-side before delivery. */
  body: string;
  moderationStatus: ModerationStatus;
  /** ISO date of payment confirmation — shown for context ("after your gift"). */
  paidAt?: string;
}

export function ThankYouBubble({ body, moderationStatus, paidAt }: ThankYouBubbleProps) {
  // Fail closed: only approved text renders. Pending/rejected show nothing —
  // the payer screen simply omits this component until delivery completes
  // (within 1h of payment confirmation per Feature 6 AC).
  if (moderationStatus !== 'approved') return null;

  const shown = body.length > MAX_THANK_YOU_CHARS ? body.slice(0, MAX_THANK_YOU_CHARS) : body;

  return (
    <View
      style={styles.bubble}
      accessible
      accessibilityLabel={`Thank-you message from the person you helped: ${shown}`}
    >
      <Text style={styles.body}>{shown}</Text>
      <Text style={styles.meta}>
        — a Bill Swipe recipient{paidAt ? ` · ${formatPaid(paidAt)}` : ''}
      </Text>
      {/* Intentionally NO reply button / onPress affordance (MVP rule). */}
    </View>
  );
}

function formatPaid(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  bubble: {
    backgroundColor: palette.secondary, // warm sand — human, not transactional
    borderRadius: 16, // card corners spec
    padding: layout.pagePaddingHorizontal,
    maxWidth: 320,
    alignSelf: 'flex-end',
    marginVertical: motion.micro / 10, // subtle rhythm; no animation gimmicks
  },
  body: {
    fontSize: typography.scale.body,
    fontFamily: typography.fontFamily.body,
    color: palette.neutralDark,
    lineHeight: 22,
  },
  meta: {
    marginTop: 8,
    fontSize: typography.scale.caption,
    color: palette.accentPass, // slate, neutral tone
  },
});
