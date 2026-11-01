# Bill Swipe — Engineering Design Doc (v0.4 draft)

Companion to `docs/PRD.md`. This document records how the scaffold in this repo
maps PRD requirements onto code, which PRD non-negotiables are already enforced
by tests, and what remains before the closed pilot (Months 1–6 of the launch plan).

## 1. Repository layout

```
bill-swipe/
├── docs/
│   ├── PRD.md                      # source of truth (v0.1 draft)
│   └── ENGINEERING_DESIGN.md       # this file
├── packages/shared/src/            # cross-platform contracts
│   ├── types.ts                    # BillCategory, PublicBillCard, PayQuote, statuses…
│   ├── api.ts                      # API_CONTRACT — route list + notes + SLAs
│   └── moderation.ts               # thank-you/story moderation (Feature 6 AC)
├── backend/src/
│   ├── server.ts                   # Fastify bootstrap + env wiring
│   ├── routes/api.ts               # all /v1 routes, zod validation, rate limits
│   └── services/
│       ├── redaction.ts            # Feature 1: PII region detection + blur regions
│       ├── upload.ts               # Feature 1: draft lifecycle, bill hash, fail-closed submit
│       ├── verification.ts         # Feature 2: OCR extraction, allowlist, auto-screen
│       ├── opsConsole.ts           # Feature 2: reviewer checklist recording (Persona 3)
│       ├── feed.ts                 # Feature 3: card stack, pass-suppression, undo window
│       ├── payments.ts             # Feature 4: ledger state machine, partner gateway
│       ├── partnerMock.ts          # licensed-partner stand-in for tests/dev only
│       ├── anonymity.ts            # Feature 5: handles, payer-safe projections
│       ├── dashboard.ts            # Feature 7: aggregates + PDF receipts
│       ├── disputes.ts             # Flow 4: case opening, reversal, republish deadline
│       ├── auth.ts                 # OTP passwordless auth, 18+ gate, KYC states
│       ├── notifications.ts        # push/SMS fan-out (stubs; APNs/FCM at impl time)
│       └── analytics.ts            # event tracker, salted ID hashing, amount buckets
├── apps/mobile/src/
│   ├── theme/tokens.ts             # design system (colors, type scale, radii, motion)
│   ├── components/                 # BillCard, SwipeControls, PayConfirmSheet,
│   │                               # StatusTimeline (+ SafetyBanner inline in sheet)
│   ├── screens/                    # FeedScreen, UploadScreen
│   ├── services/apiClient.ts       # implements packages/shared API_CONTRACT
│   ├── state/feedStore.ts          # card-stack reducer, undo timer
│   └── utils/format.ts             # tabular currency/date formatting
├── types/react-native.d.ts         # ambient RN typings (no full RN toolchain here)
└── backend/tests/                  # 92 tests, incl. contract tests vs API_CONTRACT
```

## 2. PRD non-negotiables → where they are enforced

| # | PRD rule | Code location | Test coverage |
|---|---|---|---|
| 1 | **Never hold customer funds** (money-transmission risk) | `payments.ts` has no balance APIs; every movement goes through `PartnerGateway`; `server.ts` requires `PAYMENTS_LEGAL_SIGNOFF_REF` (a counsel-memo reference — not a bare boolean) before payments activate | `payments.test.ts`, `api.contract.test.ts` LEGAL_HOLD suite |
| 2 | **Legal sign-off gates payments** | `routes/api.ts` returns 503 `LEGAL_HOLD` on quote/pay by default | contract test: quote+pay disabled by default |
| 3 | **Final amount + fee shown before charging** | `POST /quote` returns `{amountCents, feeCents, totalCents}`; pay re-derives server-side | contract test asserts `amount+fee===total` |
| 4 | **Payer never sees biller name / holder identity / address** | `anonymity.ts` projects `PublicBillCard`; publish route rejects cards containing forbidden keys (`biller_name`, `holder_id`, `account_number`, `full_address`, `original_image_key`) | feed contract test serializes responses and greps for PII keys; status-route test same |
| 5 | **Redaction before anyone else sees the bill** | `upload.ts::submitForReview` fails closed (422) if high-confidence account regions aren't applied | upload contract suite |
| 6 | **Duplicate detection** | `billHashOf` (sha-256 over bytes) checked against `knownBillHashes` (UNIQUE column in schema) | upload contract: exact re-upload → 409 |
| 7 | **Secondary doc for bills > $500** | `verification.ts::SECONDARY_DOC_THRESHOLD_CENTS`; `opsConsole.recordReview` blocks approve without it | verification tests |
| 8 | **Undo within 5 s only** | `feed.ts::UNDO_WINDOW_MS`, `canUndo` | contract test fresh vs stale swipe |
| 9 | **Pass = neutral** | `tokens.ts` pass color is slate `#6B7280`, never red; copy in `SwipeControls` | design review (manual) |
| 10 | **Every swipe has a button equivalent** | `SwipeControls` renders Pay/Pass/Save buttons alongside gesture handlers | component inspection |
| 11 | **Thank-you ≤ 280 chars, moderated, no replies** | `shared/moderation.ts` + route validation; no reply endpoint exists | moderation tests + contract tests |
| 12 | **Reports pause the bill immediately** | report/dispute routes call `db.pauseBill` synchronously before responding 202 | contract tests |
| 13 | **Disputes resolved within 2 business days** | `disputes.ts::dueBy` skips weekends | contract test asserts weekday |
| 14 | **Reversed bills republished ≤ 1 h** | `disputes.ts::republishDeadline` (+1h), returned as `republishBy` | contract test bounds the delta |
| 15 | **Receipts owner-only; existence not confirmed** | receipt route returns 404 (not 403) to non-owners | contract test |
| 16 | **Analytics: hashed IDs, bucketed amounts, no PII at ingestion** | `analytics.ts` salts+hashes user ids; `piiSafeEvent` strips raw amounts | services tests |
| 17 | **18+ at sign-up** | `auth.ts::isOfAge` checked in `/otp/start` → 403 | services tests |
| 18 | **Rate limiting on all endpoints** | `@fastify/rate-limit` registered app-wide | boot config |

## 3. Data model

The PRD SQL schema (`bills`, `swipes`, `payments`, `verification_reviews`,
`thank_you_messages`) is mirrored by the TypeScript row types in
`services/*.ts` and the persistence ports in `AppDeps.db`. The scaffold uses
in-memory fakes behind those ports; production swaps in PostgreSQL exactly as
specified (including `bill_hash UNIQUE`, `INDEX idx_bill_status`, etc.).

Deliberate deviations: none. Additions: upload drafts live in a separate
`UploadRecord` lifecycle (`draft → redacted_preview → submitted → under_review
→ published/rejected/withdrawn`) so unredacted originals are referenced only by
`originalImageKey` (encrypted store) and never appear in any payer projection.

## 4. Payment flow (Feature 4)

```
payer swipes right
  → POST /v1/bills/:id/quote      (KYC approved? legal gate open?)
  → payer confirms sheet          (final amount + fee displayed)
  → POST /v1/payments             (amount ≤ balance enforced server-side)
      authorize() via PartnerGateway    ← card data NEVER touches us
      captured → sendToBiller()
      ledger row: authorized→captured→sent_to_biller→confirmed
  → partial payment: remainder stays 'partially_funded', card re-queues
  → failure/refund: reversePayment() routes back THROUGH the partner,
    bill republish scheduled ≤ 1 hour
```

State transitions are guarded in `payments.ts` (illegal jumps throw);
`partnerMock.ts` is clearly marked dev/test-only.

## 5. What is NOT yet real (pilot blockers)

1. **Persistence** — Postgres/Redis adapters behind the `AppDeps.db` port.
2. **OCR pipeline** — `redaction.ts` consumes `OcrWord[]`; the cloud OCR + custom
   redaction model must be integrated and measured against the 95% AC on a
   200-bill test set.
3. **Licensed payment partner** — selection + agreement is the gating item
   (PRD Dependencies). Until then `PAYMENTS_LEGALLY_APPROVED` stays false and
   the app cannot move money *by construction*.
4. **Push/SMS delivery** — `notifications.ts` stubs → APNs/FCM/Twilio.
5. **Auth session layer** — OTP store is per-instance in-memory; needs Redis.
6. **Full React Native toolchain** — components type-check against ambient RN
   typings; device render tests (Detox/Maestro) still needed for the 1.5 s card
   stack and 95% gesture-accuracy ACs.
7. **KYC provider integration** — `kycOf()` port exists; provider not wired.
8. **Placeholder statistics** in the PRD remain unsourced (PRD §Data Sourcing).

## 6. Verification commands

```bash
npm test              # vitest run — 92 tests across 8 files
npx tsc --noEmit      # strict type-check incl. mobile components
node backend/src/server.ts   # boots with LEGAL_HOLD active by default
```

## 7. Change log

| Date | Version | Changes |
|---|---|---|
| Nov 1, 2026 | 0.2–0.4 | Scaffold phases 1–4: services, routes, contract tests, UploadScreen, status timeline tests, dispute client method |
| Nov 1, 2026 | 0.4 | This design doc; RN ambient typings extended (TouchableOpacity, Image a11y) |
