/**
 * SwipeControls — Pay / Pass / Save.
 * PRD design requirement: EVERY swipe action has a button equivalent, with
 * screen-reader labels. Pass is slate, NOT red — a pass is neutral.
 */

import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { palette, layout, typography, semantic } from '../theme/tokens';

interface Props {
  onPay: () => void;
  onPass: () => void;
  onSave: () => void;
  disabled?: boolean;
}

export function SwipeControls({ onPay, onPass, onSave, disabled }: Props) {
  return (
    <View_row>
      <ActionButton label="Save for later" kind="save" onPress={onSave} disabled={disabled} />
      <ActionButton label="Pass on this bill" kind="pass" onPress={onPass} disabled={disabled} />
      <ActionButton label="Pay this bill" kind="pay" onPress={onPay} disabled={disabled} />
    </View_row>
  );
}

export function ActionButton({
  label,
  kind,
  onPress,
  disabled,
}: {
  label: string;
  kind: 'pay' | 'pass' | 'save';
  onPress: () => void;
  disabled?: boolean;
}) {
  const s = kind === 'pay' ? semantic.payAction : kind === 'pass' ? semantic.passAction : semantic.saveAction;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.btn,
        {
          backgroundColor: s.bg,
          borderColor: 'border' in s ? s.border : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.text, { color: s.fg }]}>{label}</Text>
    </Pressable>
  );
}

// tiny helper so the file stays dependency-light in this scaffold
const View_row = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);

const styles = StyleSheet.create({
  btn: {
    height: layout.buttonHeight,
    minWidth: 48, // touch target floor (44 iOS / 48 Android handled by parent spacing)
    borderRadius: layout.buttonRadius,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  text: { fontFamily: typography.fontFamily.headings, fontSize: typography.scale.body },
});
