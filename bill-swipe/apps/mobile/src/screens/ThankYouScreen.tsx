/**
 * ThankYouScreen — bill-holder side composer for PRD Feature 6.
 *
 * Closes the loop after a payment is confirmed: the holder writes ONE short
 * thank-you (<=280 chars) that goes through automated moderation before it is
 * delivered to the payer. Rules mirrored from backend/src/services/thankYou.ts:
 *   - one message per payment; the composer locks after send (no replies in MVP)
 *   - live character counter against MAX_THANK_YOU_CHARS
 *   - moderation rejections surface a neutral explanation, never a silent drop
 *   - identity stays anonymous: nothing here lets the holder type into a
 *     "from:" field; the payer only ever sees "a Bill Swipe recipient"
 */

import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { MAX_THANK_YOU_CHARS } from '@bill-swipe/shared';
import { api, ApiClientConfig } from '../services/apiClient';
import { palette, typography, layout, motion } from '../theme/tokens';

export interface ThankYouScreenProps {
  cfg: ApiClientConfig;
  paymentId: string;
  /** paidAt from the confirmation screen — shown as context above the composer */
  paidAt?: string;
}

type SendState = 'editing' | 'sending' | 'sent' | 'blocked' | 'duplicate' | 'failed';

export function ThankYouScreen({ cfg, paymentId }: ThankYouScreenProps) {
  const [text, setText] = useState('');
  const [state, setState] = useState<SendState>('editing');
  const remaining = MAX_THANK_YOU_CHARS - text.length;

  async function send() {
    if (!text.trim() || state === 'sending') return;
    setState('sending');
    try {
      await api.thankyou(cfg, paymentId, text.trim());
      setState('sent'); // locked: one message per payment (Feature 6)
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 400) setState('blocked');       // moderation or empty
      else if (status === 409) setState('duplicate'); // already sent
      else setState('failed');
    }
  }

  if (state === 'sent') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.sentTitle} accessibilityRole="header">Thank you note sent</Text>
        <Text style={styles.muted}>It will reach your donor within an hour.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Say thanks — anonymously</Text>
        <Text style={styles.muted}>
          Your donor never sees your name or address. You can send one short note.
        </Text>

        <TextInput
          value={text}
          onChangeText={(t) => state === 'editing' && setText(t.slice(0, MAX_THANK_YOU_CHARS))}
          multiline
          maxLength={MAX_THANK_YOU_CHARS}
          placeholder="A few words about what this meant…"
          placeholderTextColor={palette.accentPass}
          style={styles.input}
          accessibilityLabel={`Thank-you message, ${remaining} characters remaining`}
          editable={state !== 'sending'}
        />
        <Text style={[styles.counter, remaining < 40 ? styles.counterWarn : null]}>{remaining}</Text>

        {(state === 'blocked' || state === 'duplicate' || state === 'failed') && (
          <Text accessibilityRole="alert" style={styles.error}>
            {state === 'blocked' &&
              'This note was held by our safety review. Please avoid contact details, links, or payment requests.'}
            {state === 'duplicate' && 'A thank-you has already been sent for this bill.'}
            {state === 'failed' && 'Something went wrong. Your note was not lost — please try again.'}
          </Text>
        )}

        <Pressable
          onPress={send}
          disabled={!text.trim() || state === 'sending' || state === 'duplicate'}
          accessibilityRole="button"
          accessibilityLabel="Send thank-you note"
          style={(!text.trim() || state === 'sending' || state === 'duplicate') ? styles.sendBtnDisabled : styles.sendBtn}
        >
          <Text style={styles.sendBtnText}>{state === 'sending' ? 'Sending…' : 'Send note'}</Text>
        </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: layout.pagePaddingHorizontal, gap: 12 },
  title: { fontSize: typography.scale.h3, fontFamily: typography.fontFamily.headings, color: palette.neutralDark },
  muted: { fontSize: typography.scale.caption, color: palette.accentPass },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: palette.secondary,
    borderRadius: 16, // card-corner spec
    padding: layout.pagePaddingHorizontal,
    fontSize: typography.scale.body,
    fontFamily: typography.fontFamily.body,
    color: palette.neutralDark,
    backgroundColor: palette.neutralLight,
    textAlignVertical: 'top',
  },
  counter: { textAlign: 'right', fontSize: typography.scale.caption, color: palette.accentPass, fontVariant: ['tabular-nums'] },
  counterWarn: { color: palette.warning },
  error: { color: palette.error, fontSize: typography.scale.caption },
  sentTitle: { fontSize: typography.scale.h3, fontFamily: typography.fontFamily.headings, color: palette.accentPay },
  sendBtn: {
    height: 48, // button spec: 48px height, >=44px touch target
    borderRadius: 12,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    transitionProperty: 'opacity',
    transitionDuration: `${motion.micro}ms`,
  },
  sendBtnPressed: { opacity: 0.85 },
  sendBtnDisabled: { backgroundColor: palette.accentPass },
  sendBtnText: { color: '#FFFFFF', fontSize: typography.scale.body, fontFamily: typography.fontFamily.headings },
});
