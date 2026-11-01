/**
 * Bill Swipe Design Tokens — single source of truth.
 * Derived from docs/PRD.md § "Design System".
 * Tone: warm and serious, not glamorous. No gamification.
 */

export const palette = {
  /** Deep teal — trust, calm */
  primary: '#1F5F5B',
  /** Warm sand — approachable */
  secondary: '#E9DCC9',
  /** Forest green — used ONLY for the Pay action */
  accentPay: '#2E7D5B',
  /** Slate — used for the Pass action. Never red: a pass is neutral, not a rejection. */
  accentPass: '#6B7280',
  warning: '#D97706',
  error: '#B42318',
  neutralDark: '#1F2937',
  neutralLight: '#F7F5F2',
} as const;

export const typography = {
  fontFamily: {
    headings: 'Inter-SemiBold',
    body: 'Inter-Regular',
    /** Amounts and dates use tabular numerals so figures line up on the card */
    figures: 'Inter-Medium',
  },
  scale: {
    h1: 28,
    h2: 22,
    h3: 18,
    body: 16,
    caption: 13,
  },
} as const;

export const layout = {
  cardRadius: 16,
  buttonRadius: 12,
  buttonHeight: 48,
  minTouchTarget: { ios: 44, android: 48 },
  pagePaddingHorizontal: 20,
} as const;

export const motion = {
  micro: 200,
  cardTransition: 400,
} as const;

export const accessibility = {
  standard: 'WCAG 2.2 AA',
  /** PRD rule: every swipe action must have a button equivalent + screen-reader label. */
  swipeButtonEquivalents: true,
} as const;

/**
 * Contrast pairs that meet WCAG 2.2 AA (>= 4.5:1 for body text).
 * NOTE: white-on-secondary (#E9DCC9) fails contrast and must NOT be used for text.
 */
export const semantic = {
  textOnLight: palette.neutralDark,
  textOnDark: '#FFFFFF',
  payAction: { bg: palette.accentPay, fg: '#FFFFFF' },
  passAction: { bg: palette.accentPass, fg: '#FFFFFF' },
  saveAction: { bg: 'transparent', border: palette.primary, fg: palette.primary },
  urgentDueDate: palette.warning,
  error: palette.error,
} as const;
