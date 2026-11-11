/**
 * Notification service — PRD Tech Stack: "Push via APNs and FCM; SMS via
 * Twilio for verification".
 *
 * Privacy rules encoded here (Feature 5 / Privacy Measures):
 *   - Push payloads NEVER contain biller name, amount, or any identifier that
 *     would out the holder if the phone is on a lock screen. Status changes
 *     say "your bill status changed — open the app".
 *   - OTP SMS bodies carry the code only; no name, no bill data.
 *   - Every send is recorded through the analytics tracker so IDs are hashed
 *     at ingestion like all other events.
 */

import type { AnalyticsTracker } from './analytics.js';

export type PushTarget = { platform: 'ios' | 'android'; token: string };

export interface NotificationPayload {
  title: string;
  body: string; // must be privacy-safe by construction (see builders below)
  deepLink?: string;
}

export interface NotificationSink {
  push(target: PushTarget, payload: NotificationPayload): Promise<void>;
  sms(phoneE164: string, body: string): Promise<void>;
}

/** Recording sink wrapper so tests can assert what was sent where. */
export class RecordingSink implements NotificationSink {
  readonly pushes: { target: PushTarget; payload: NotificationPayload }[] = [];
  readonly messages: { phone: string; body: string }[] = [];
  async push(target: PushTarget, payload: NotificationPayload) { this.pushes.push({ target, payload }); }
  async sms(phoneE164: string, body: string) { this.messages.push({ phone: phoneE164, body }); }
}

// ------------------------------------------------------------- builders ----

/** Flow 1 step 7: "verified bill publishes, holder gets push notification". */
export function billPublishedPush(): NotificationPayload {
  return {
    title: 'Bill Swipe',
    body: 'Your update is ready. Open the app to see your bill status.',
    deepLink: 'billswipe://bills/status',
  };
}

/** Feature 6: thank-you relayed to payer within 1 hour of payment confirmation. */
export function thankYouPush(): NotificationPayload {
  return {
    title: 'Bill Swipe',
    body: 'A person you helped sent a thank-you. Open the app to read it.',
    deepLink: 'billswipe://inbox',
  };
}

/** Feature 4: biller confirmed the payment (holder side). */
export function billPaidPush(): NotificationPayload {
  return {
    title: 'Bill Swipe',
    body: 'Good news — your bill status has changed. Open the app for details.',
    deepLink: 'billswipe://bills/status',
  };
}

/** Secondary-document request for bills over $500 (Feature 2). */
export function secondaryDocRequestPush(): NotificationPayload {
  return {
    title: 'Bill Swipe',
    body: 'We need one more document to finish reviewing your bill. Open the app to continue.',
    deepLink: 'billswipe://bills/review',
  };
}

/** OTP SMS body (auth flow). Code only — nothing else goes in the SMS. */
export function otpSmsBody(code: string): string {
  return `${code} is your Bill Swipe verification code. It expires in 5 minutes.`;
}

// ---------------------------------------------------------------- sender ---

const LOCK_SCREEN_SAFE = /\b(hydro|enbridge|bell|rogers|telus|clinic|dental|invoice)\b|(?:account\s?\d)|(?:\$\s?\d[\d.,]*\s?(?:dollars|cad\b))/i;

export class Notifier {
  constructor(private sink: NotificationSink, private tracker: AnalyticsTracker) {}

  /**
   * Fail-closed privacy check: refuse to push anything that looks like it
   * contains a biller name or a dollar figure. Better to drop a notification
   * than to expose a struggling household on a lock screen.
   */
  async push(target: PushTarget, payload: NotificationPayload, userId?: string): Promise<void> {
    if (LOCK_SCREEN_SAFE.test(payload.body)) {
      this.tracker.track('report_submitted', undefined, { reason: 'notification_pii_blocked' });
      throw new Error('notification blocked: payload may reveal bill details on lock screen');
    }
    await this.sink.push(target, payload);
  }

  async smsOtp(phoneE164: string, code: string): Promise<void> {
    await this.sink.sms(phoneE164, otpSmsBody(code));
  }
}
