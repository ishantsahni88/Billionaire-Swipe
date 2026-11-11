# Bill Swipe: Product Requirements Document (PRD)

## 📋 Document Overview

- **Product Name:** Bill Swipe
- **Version:** 0.1 (Draft)
- **Date:** October 31, 2026
- **Author:** Product Team
- **Stakeholders:** Founder, Engineering Lead, Compliance/Legal Counsel, Payments Partner, Design Lead, Trust & Safety Lead
- **Status:** Draft, not yet reviewed

## 🎯 Executive Summary

Bill Swipe is a mobile app where ordinary people upload a bill they cannot pay (a hydro bill, a dental invoice, a phone plan, a rent shortfall) and wealthy users browse those bills like a dating app. Swipe right to pay a bill. Swipe left to pass. A paid bill is settled directly with the biller, and the payer gets a short, anonymized thank-you back.

The idea sits between peer-to-peer giving and micro-philanthropy. It is more personal than a donation pool because the payer sees a specific bill with a specific amount and a short story. It is more accountable than a crowdfunding page because the money goes straight to the utility or clinic.

The product only works if three things are true at once: the billionaires show up, the bills are real and verified, and the money reaches the biller without the app ever holding it in a way that creates a money-transmission problem. Those three constraints drive most of the requirements below.

**Positioning note:** The "pay or pass" framing is memorable, but it puts a lot of weight on the swipe as a decision. Some users will read left-swipe as a judgment on their need. The copy and the card design need to treat a pass as neutral.

## 💼 Business Objectives

### Primary Goals

1. Verify and fund at least 1,000 bills in the first 90 days of a closed pilot.
2. Keep the average time from upload to funded bill under 72 hours.
3. Build a repeatable donor pool of at least 100 active payers before opening public upload.
4. Earn a take rate on funded bills (or a platform fee paid by payers) that covers verification and payment costs.

### Success Metrics (KPIs)

| Metric | Target (Pilot, Day 90) | Target (Month 12) | Measurement Method |
|---|---|---|---|
| Bills uploaded | 2,000 | 50,000 | Database count |
| Bills verified (pass review) | 70% of uploads | 85% of uploads | Verification pipeline logs |
| Bills funded | 1,000 | 20,000 | Payment ledger |
| Median time, upload to funded | 72 hours | 24 hours | Event timestamps |
| Active payers (paid at least once in 30 days) | 100 | 2,500 | Payment ledger |
| Repeat payer rate (pays 2+ bills) | 35% | 50% | Payment ledger |
| Recipient satisfaction (post-payment survey) | 4.2/5 | 4.5/5 | In-app survey |
| Fraud rate (chargebacks, fake bills) | Under 1% of funded value | Under 0.5% | Ops review |

## 👥 Target Users

### Persona 1: The Bill-Holder (Recipient)

- **Who:** Adults with a specific, documented bill they cannot pay this cycle. Examples: a single parent behind on a hydro bill, a freelancer with an unexpected dental invoice, a student with a phone bill that will be disconnected.
- **Goals:** Keep the service on, avoid a collections hit, get the bill paid without a humiliating public appeal.
- **Pain points:** Existing options are GoFundMe-style appeals (public, exhausting), charity intake forms (slow, bureaucratic), or nothing.
- **Tech comfort:** Varies widely. Many will be on a phone only.
- **Key needs:** Privacy (name and address hidden), speed, clear status, no judgment.

### Persona 2: The Payer (Billionaire or High-Net-Worth Donor)

- **Who:** Wealthy individuals who want to give, but who find large foundations abstract and slow.
- **Goals:** Direct impact, something visible to them, low effort per gift, a bit of fun.
- **Pain points:** Charity feels distant and bureaucratic. They can't see where money goes.
- **Key needs:** Quick browsing, verified bill details, proof of payment, a clear record of what they funded.

### Persona 3: The Verifier (Internal Ops)

- **Who:** Our own review staff who confirm bills are real before they go live.
- **Key needs:** A queue, a clear checklist, fast decisions, fraud flags.

## 🔍 Problem Statement

**Current situation:** Households facing a single unpayable bill have few fast, dignified options. Public appeals are slow and emotionally costly. Utilities and clinics offer hardship plans, but these take time and paperwork. Wealthy donors want to help but rarely see the direct result of a gift.

**Problem:** There is no channel that connects a specific unpaid bill to a specific person willing to pay it, with the money going straight to the biller and the recipient staying anonymous.

**Impact:**
- Disconnections, late fees, and collections damage credit and can cascade into housing and employment problems.
- Donors lose interest when they cannot see outcomes.
- Charities spend a large share of their budget on intake and verification that a direct model could compress.

*Note: The figures above are placeholders and need sourcing before this PRD goes to stakeholders. See Dependencies.*

## 💡 Solution Overview

Bill Swipe lets a verified bill-holder upload a redacted bill. The app verifies it, publishes it as a card in the payer feed, and settles the payment directly with the biller when a payer swipes right. The app never pools money. Each payment goes from the payer to the biller through a licensed payment partner.

### Core Loop

1. **Upload:** Bill-holder photographs or uploads a PDF of a bill. Account numbers are redacted automatically.
2. **Verify:** Ops staff and automated checks confirm the biller, amount, and that the bill is not already paid.
3. **Publish:** Verified bill appears as a card: biller category, amount, due date, short story (optional, bill-holder written, moderated).
4. **Swipe:** Payer swipes right to pay, left to pass.
5. **Settle:** Payment is sent to the biller. Payer gets a receipt. Bill-holder gets a confirmation that the bill is paid.
6. **Close the loop:** Bill-holder can send a short thank-you, which is relayed without revealing identities.

## ✨ Features & Requirements

### Phase 1: MVP (Closed Pilot, Months 0–6)

#### Feature 1: Bill Upload and Redaction

- **Description:** Bill-holders upload a bill and the system strips identifying data before anyone else sees it.
- **User story:** As a bill-holder, I want to upload my bill without exposing my full account details, so that I can ask for help without giving strangers my personal information.
- **Requirements:**
  - Accept JPEG, PNG, and PDF, max 10 MB.
  - Automatically detect and blur account numbers, names, full addresses, and barcodes.
  - Show the bill-holder a redacted preview and let them adjust redaction before submitting.
  - Store the unredacted original encrypted, accessible only to Verification staff.
- **Priority:** CRITICAL
- **Acceptance criteria:**
  - Account number redaction catches 95%+ of cases in a test set of 200 sample bills.
  - Bill-holder can edit redaction before submission.
  - Unredacted originals are not viewable by any payer account.

#### Feature 2: Bill Verification Pipeline

- **Description:** A combination of automated checks and human review confirms that a bill is genuine and unpaid.
- **User story:** As a payer, I want to know the bill is real, so that I don't fund a scam.
- **Requirements:**
  - Extract biller name, amount, due date, and account holder initials via OCR.
  - Cross-check biller against a list of known utilities, clinics, telecom providers, and landlords.
  - Flag duplicate uploads (same bill hash or same biller + amount + date).
  - Ops reviewer confirms on a checklist: biller legitimate, amount matches, no visible "paid" stamp, bill-holder identity consistent with account.
  - Ask the bill-holder for a secondary document (ID check or recent statement) for bills over $500.
- **Priority:** CRITICAL
- **Acceptance criteria:**
  - Verification decision within 24 hours for 90% of submissions.
  - Duplicate detection catches exact re-uploads 100% of the time.
  - Fraud rate on funded bills under 1% in the pilot.

#### Feature 3: Payer Swipe Feed

- **Description:** The swipe interface where payers browse verified bills.
- **User story:** As a payer, I want to quickly review bills and decide to pay or pass, so that I can give without spending hours on it.
- **Requirements:**
  - Card shows: biller category (not biller name for privacy during pilot, optional later), amount, days until disconnection or due date, one-line story (optional), redacted bill image on tap.
  - Right swipe or tap "Pay" opens a confirmation sheet with the exact amount and fee.
  - Left swipe or tap "Pass" removes the card. Passed bills do not reappear for that payer for 30 days.
  - Undo last swipe (within 5 seconds).
  - Filters: category (utilities, medical, telecom, housing), amount range, urgency (due within 7 days).
  - Payers can save a bill to "Consider later."
- **Priority:** CRITICAL
- **Acceptance criteria:**
  - Card stack loads in under 1.5 seconds.
  - Swipe gesture recognized at 95%+ accuracy.
  - Pay confirmation always shows the final amount before charging.

#### Feature 4: Direct Biller Payment

- **Description:** Payments go from the payer to the biller, not to a Bill Swipe account.
- **User story:** As a payer, I want my money to reach the utility directly, so that I know the bill is paid.
- **Requirements:**
  - Integrate with a licensed bill-payment or payment-facilitation provider (see Dependencies). Bill Swipe does not hold customer funds.
  - Payment is released to the biller only after the payer's card or bank authorization clears.
  - Partial payments are allowed when a payer funds part of a bill. The remaining balance is republished.
  - Payer receives a receipt showing biller, amount paid, and confirmation number.
- **Priority:** CRITICAL
- **Acceptance criteria:**
  - Biller confirmation is recorded for 99%+ of payments within 72 hours.
  - Failed payments are reversed and the bill is republished within 1 hour.
  - No customer funds are held in a Bill Swipe-controlled balance.

#### Feature 5: Anonymity and Privacy Controls

- **Description:** Both sides stay anonymous to each other by default.
- **User story:** As a bill-holder, I want the payer not to know my name or address, so that I'm not exposed to judgment or attention.
- **Requirements:**
  - Bill-holders appear as a first name and last initial, or a generated handle.
  - Payers appear as a generated handle.
  - Payer identity is never shown to the bill-holder, except as a generic "anonymous donor" line.
  - Full address is never shown in the card. Only the city or region is shown.
- **Priority:** CRITICAL
- **Acceptance criteria:**
  - No personal identifiers appear in any payer-facing screen or API response.
  - Anonymity review passed before pilot launch.

#### Feature 6: Thank-You Relay

- **Description:** A short, moderated message from the bill-holder to the payer.
- **User story:** As a bill-holder, I want to thank the person who helped me, so that the exchange feels human.
- **Requirements:**
  - One message per funded bill, max 280 characters.
  - Messages pass automated moderation before delivery.
  - Replies are not possible in the MVP. This keeps the relationship one-directional and avoids harassment.
- **Priority:** MEDIUM
- **Acceptance criteria:**
  - Messages delivered within 1 hour of payment confirmation.
  - Moderation catches 90%+ of harassment and contact-information leaks.

#### Feature 7: Payer Dashboard

- **Description:** A record of what each payer has funded.
- **User story:** As a payer, I want to see the impact of my giving, so that I stay motivated.
- **Requirements:**
  - Total funded, number of bills, categories covered.
  - Receipts downloadable as PDF.
  - Tax-receipt support is out of scope for the MVP (see Out of Scope).
- **Priority:** HIGH
- **Acceptance criteria:**
  - Dashboard updates within 5 minutes of payment confirmation.
  - Receipts generate in under 3 seconds.

### Phase 2: Post-MVP (Months 6–12)

- **Feature 8: Public upload.** Open bill upload to anyone, behind the verification pipeline.
- **Feature 9: Hardship referrals.** When a bill is passed, suggest the utility's hardship program or a local assistance line.
- **Feature 10: Recurring pledges.** Payers can set a monthly budget and get a curated feed.
- **Feature 11: Charity matching.** Payers can route bills to partner charities for categories like medical or housing.
- **Feature 12: Bill-holder replies.** Limited, moderated one-line follow-up after a payment, if pilot data shows it helps retention.

## 🎨 Design System

### Visual Direction

The tone is warm and serious, not glamorous. The product is about people who are struggling, so the design should avoid anything that looks like a luxury brand or a game.

- **Primary:** Deep teal `#1F5F5B` (trust, calm)
- **Secondary:** Warm sand `#E9DCC9` (approachable)
- **Accent (Pay):** Forest green `#2E7D5B`
- **Accent (Pass):** Slate `#6B7280`, not red. A pass is neutral, not a rejection.
- **Warning:** Amber `#D97706`
- **Error:** Brick `#B42318`
- **Neutral dark:** `#1F2937`
- **Neutral light:** `#F7F5F2`

### Typography

- **Headings:** Inter SemiBold
- **Body:** Inter Regular
- **Amounts and dates:** Inter Medium with tabular numerals, so figures line up on the card
- **Scale:** H1 28pt, H2 22pt, H3 18pt, body 16pt, caption 13pt

### Components

- **BillCard:** Redacted bill thumbnail, amount, due date, category chip, optional story
- **SwipeControls:** Pay, Pass, and Save buttons
- **PayConfirmSheet:** Final amount, fee, biller, and confirm button
- **StatusTimeline:** Uploaded, verified, funded, paid
- **ThankYouBubble:** Message from the bill-holder
- **SafetyBanner:** Fraud and scam warning on the confirmation sheet

### Specifications

| Element | Specification |
|---|---|
| Card corners | 16px radius |
| Buttons | 12px radius, 48px height |
| Minimum touch target | 44×44px (iOS), 48×48px (Android) |
| Page padding | 20px horizontal |
| Animation | 200ms micro, 400ms card transitions |
| Accessibility | WCAG 2.2 AA minimum; screen-reader equivalents for every swipe action |

**Design requirement:** Every swipe action must have a button equivalent. Swipe is not the only way to act.

## 🏗️ Technical Architecture

### Tech Stack (Proposed)

- **Mobile:** React Native (single codebase for iOS and Android). Revisit native if performance targets fail.
- **Backend:** Node.js (TypeScript) with Express or Fastify
- **Database:** PostgreSQL (primary), Redis (sessions, card-stack caching)
- **File storage:** Encrypted object storage (S3 or equivalent in a Canadian region for the pilot)
- **OCR and redaction:** Cloud OCR service plus a custom redaction model. Originals never leave the encrypted store unredacted.
- **Payments:** Licensed bill-payment or payment-facilitation partner (see Dependencies). Stripe or equivalent for payer card capture only if the partner allows it.
- **Notifications:** Push via APNs and FCM; SMS via Twilio for verification
- **Auth:** Passwordless login (phone or email OTP), plus KYC for payers (see Security)
- **Analytics:** Product analytics tool of choice, with PII stripped at ingestion
- **Hosting:** Canadian region cloud for the pilot

### Architecture Overview

```
Mobile app (iOS / Android)
        │
        ▼
API gateway (rate limits, auth)
        │
 ┌──────┼──────────────────────┐
 ▼      ▼                      ▼
Bill service   Feed service   Payment service ──► Licensed payment partner ──► Biller
 │              │                 │
 ▼              ▼                 ▼
Verification  Redis cache     Ledger (PostgreSQL)
queue (ops)
 │
 ▼
Encrypted originals store (restricted access)
```

### Core Data Model

```sql
-- BILLS
CREATE TABLE bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    holder_id UUID NOT NULL REFERENCES users(id),
    biller_name VARCHAR(200),
    biller_category VARCHAR(50),       -- utility, medical, telecom, housing, other
    amount_cents INTEGER NOT NULL,
    amount_funded_cents INTEGER NOT NULL DEFAULT 0,
    due_date DATE,
    redacted_image_url TEXT,
    original_image_key TEXT,           -- encrypted, restricted access
    story TEXT,
    status VARCHAR(20) DEFAULT 'pending_review',  -- pending_review, verified, published, partially_funded, paid, rejected, withdrawn
    bill_hash VARCHAR(64) UNIQUE,      -- duplicate detection
    region VARCHAR(50),                -- city/region only
    created_at TIMESTAMP DEFAULT NOW(),
    verified_at TIMESTAMP,
    paid_at TIMESTAMP,
    INDEX idx_bill_status (status, created_at)
);

-- SWIPES
CREATE TABLE swipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id UUID NOT NULL REFERENCES users(id),
    bill_id UUID NOT NULL REFERENCES bills(id),
    action VARCHAR(10) NOT NULL,       -- pay, pass, save
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(payer_id, bill_id),
    INDEX idx_payer_swipes (payer_id, created_at DESC)
);

-- PAYMENTS (ledger; no balances held)
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES bills(id),
    payer_id UUID NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL,
    partner_txn_id VARCHAR(255) UNIQUE,
    status VARCHAR(20) NOT NULL,       -- authorized, captured, sent_to_biller, confirmed, failed, reversed
    biller_confirmation VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_bill_payments (bill_id)
);

-- VERIFICATION REVIEWS
CREATE TABLE verification_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES bills(id),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    decision VARCHAR(20) NOT NULL,     -- approve, reject, request_more
    checklist JSONB NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- THANK-YOU MESSAGES
CREATE TABLE thank_you_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    body VARCHAR(280) NOT NULL,
    moderation_status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);
```

*Users, payer KYC records, and notification tables are omitted here for length and will be specified in the engineering design doc.*

## 📱 User Flows

### Flow 1: Bill-Holder Upload

1. Open app → sign in with phone or email OTP
2. Tap "Upload a bill"
3. Photograph or select bill (PDF or image)
4. Review auto-redacted preview, adjust if needed
5. Enter amount, due date, biller category, optional short story
6. Submit → "Under review, usually within 24 hours"
7. Ops verifies → bill publishes, holder gets push notification
8. Holder tracks status on timeline

### Flow 2: Payer Swipe and Pay

1. Open feed → card stack of verified bills
2. Read card, tap for redacted bill image if needed
3. Swipe right or tap Pay → confirmation sheet with amount, fee, biller category
4. Confirm → authorize payment
5. Success screen → receipt, "Your gift is on its way"
6. Bill status updates when biller confirms

### Flow 3: Partial Funding

1. Payer chooses an amount less than the balance
2. Payment processes; bill shows remaining balance
3. Bill stays in feed until fully funded or due date passes

### Flow 4: Dispute and Reversal

1. Payer or holder reports a problem (wrong biller, bill already paid, scam)
2. Case opens; bill is paused from the feed
3. Ops reviews within 2 business days
4. Outcome: refund to payer, bill republished, or account action

## 🔐 Security & Compliance

### Security Requirements

- All data encrypted in transit (TLS 1.2+) and at rest (AES-256)
- Unredacted bill originals accessible only to Verification role, with access logging
- Payer card and bank data handled entirely by the payment partner. Bill Swipe never stores full card numbers.
- Rate limiting on all endpoints
- Account lockout after repeated failed OTP attempts
- Regular dependency and penetration testing before pilot and quarterly after

### Compliance

- **Money transmission:** This is the main legal risk. The model is designed so Bill Swipe never holds customer funds and instead directs payments to billers through a licensed partner. Legal counsel must confirm this structure before any payment is processed. See Risks.
- **Charitable giving:** If any feature touches tax receipts or charity status, the product needs separate review. Tax receipts are out of scope for the MVP.
- **Privacy:** PIPEDA compliance for Canadian users; PIPEDA-aligned consent and retention language for the pilot. GDPR and CCPA apply when expanding.
- **Consumer protection:** Clear terms on what a payment does and does not guarantee. No promise that a bill will be paid until the biller confirms.
- **Payer KYC:** Payers verified to the standard required by the payment partner, which typically means identity and sanctions screening.
- **Minors:** Bill-holders and payers must be 18+. Enforced at sign-up.

### Privacy Measures

- Redaction applied before any third party or any non-verification staff sees a bill
- Payers never see bill-holder identity or full address
- Data retention: original bills deleted 90 days after a bill is paid or withdrawn, unless a dispute is open
- Users can request deletion of their account and uploaded bills
- No sale of user data

### Content and Fraud Controls

- Verification checklist required before any bill publishes
- Duplicate and fake-biller detection
- Scam pattern detection on story text (requests for money outside the app, external links, contact-information leaks)
- Payers can report a bill, which pauses it immediately pending review
- Bill-holder accounts flagged after two rejected submissions for review

## 📊 Analytics & Tracking

### Events to Track

| Event | Trigger | Data Captured |
|---|---|---|
| `bill_uploaded` | Holder submits a bill | holder_id, category, amount_bucket, has_story |
| `bill_verified` | Ops approves | bill_id, review_duration, decision |
| `bill_rejected` | Ops rejects | bill_id, rejection_reason |
| `bill_published` | Bill enters the feed | bill_id, category, region |
| `card_viewed` | Payer sees a card | payer_id, bill_id, dwell_time |
| `swipe_pay` | Payer swipes right | payer_id, bill_id, amount |
| `swipe_pass` | Payer swipes left | payer_id, bill_id, category |
| `payment_completed` | Payment confirmed by biller | payment_id, amount, time_to_fund |
| `bill_paid` | Bill fully funded and confirmed | bill_id, total_funded, days_to_paid |
| `thank_you_sent` | Holder sends message | payment_id, char_count |
| `report_submitted` | Any report | reporter_id, bill_id, reason |
| `dispute_opened` | Dispute created | payment_id, dispute_type |

**Analytics rule:** Holder and payer identifiers are hashed in analytics. No amounts are linked to named individuals outside the payment ledger.

## 🚀 Launch Plan

### Phase 1: Closed Pilot (Months 1–6)

- **Months 1–2:** Legal structure confirmed, payment partner selected, redaction and verification tooling built, design system set
- **Months 3–4:** Holder upload, ops verification console, payer feed, direct biller payment, thank-you relay
- **Month 5:** Dispute flow, dashboards, security review, penetration test
- **Month 6:** Closed pilot with 100 payers, 1 city, one biller category (utilities)

**Pilot success gate:** 1,000 bills funded, fraud under 1% of funded value, median time to funded under 72 hours, no privacy incidents. Pilot does not expand until all four are met.

### Phase 2: Expansion (Months 7–12)

- Add medical and telecom categories
- Open public upload behind verification
- Expand to 3 cities
- Launch recurring pledges and hardship referrals

### Rollout Strategy

- Invite-only payer cohort. Bill-holder access opens through local community partners to avoid overwhelming verification.
- Staged category rollout so verification capacity matches volume.
- Feature flags for public upload, so it can be switched off quickly if fraud rises.

## ⚠️ Risks & Mitigation

| Risk | Impact | Probability | Mitigation Strategy |
|---|---|---|---|
| Classified as money transmission or unlicensed payments | Critical | Medium | Never hold funds; route all payments through licensed partner; legal sign-off before launch |
| Fake or altered bills | High | High | OCR cross-checks, biller allowlist, ops checklist, secondary ID for larger bills |
| Privacy breach exposing bill data | Critical | Low | Redaction before access, restricted originals, encryption, access logs, quarterly testing |
| Payers lose interest after novelty wears off | High | Medium | Dashboards showing impact, recurring pledges, thank-you relay |
| Shame or stigma for bill-holders | High | Medium | Anonymity by default, neutral "pass" language, no public leaderboards of need |
| Verification backlog | Medium | High | Staged rollout, automated pre-screening, bill-holder status transparency |
| Biller refuses or delays payments | Medium | Medium | Partner-level biller agreements; "payment pending" state; holder notification |
| Payers treat it as entertainment and disengage from the real need | Medium | Medium | Keep the product serious in copy and design; no gamification |
| Reputational risk from perceived exploitation (wealthy deciding who gets help) | High | Medium | Transparent criteria, no ranking of holders by story quality, public impact reporting |
| Chargebacks from payers | Medium | Medium | Clear confirmation step, receipts, dispute flow, payment partner fraud tools |

## 📦 Dependencies

### External

- Legal review of payment structure and charitable-giving rules (2–4 weeks)
- Licensed payment or bill-payment partner agreement and onboarding (4–8 weeks)
- Biller relationships or partner APIs for pilot utilities (varies; pilot may need manual biller payment at first)
- Cloud OCR service access
- Payer KYC provider
- Apple App Store and Google Play review

### Internal

- Legal counsel engaged before any engineering on payments
- Verification staff hired and trained before pilot
- Design system finalized before build
- Security review scheduled before pilot

### Data Sourcing

- Impact figures in this PRD (disconnection rates, cost of late fees, donor behaviour) are placeholders. Each needs a cited source before stakeholder review.

## ❌ Out of Scope

**Not included in the MVP:**
- Holding or storing customer funds in a Bill Swipe balance
- Tax receipts or charity registration
- Public bill-holder profiles or leaderboards
- Replies from bill-holders to payers
- Bills for rent paid directly to landlords (pilot covers utilities only)
- Loans, advances, or credit products
- Payer-to-payer features
- Native desktop or web app
- Matching payers to specific bill-holders by personal preference

**Future consideration:**
- Charity partnership and tax receipt support
- Government or utility hardship program integrations
- Cross-border payments

## 📝 Appendix

### A. Glossary

- **Bill-holder:** A person who uploads a bill for payment help.
- **Payer:** A user who funds bills.
- **Biller:** The company or service the bill is owed to (utility, clinic, telecom provider).
- **Verification:** The review process confirming a bill is genuine and unpaid.
- **Redaction:** Removal of identifying details from a bill image before it is shown to payers.
- **Money transmission:** Regulated activity of receiving funds from one party to transmit to another. The core legal question for this product.
- **Take rate:** Share of funded value Bill Swipe keeps as a fee.

### B. References

- Canadian privacy law: PIPEDA
- Money transmission and payment licensing requirements (to be confirmed by counsel for Ontario and federal rules)
- Apple App Store Review Guidelines (sections on payments and user-generated content)
- Google Play Developer Policies (sections on payments and user-generated content)

### C. Change Log

| Date | Version | Changes | Author |
|---|---|---|---|
| Oct 31, 2026 | 0.1 | Initial draft | Product Team |
| TBD | 0.2 | Post-legal review updates | TBD |
| TBD | 1.0 | Post-pilot planning | TBD |

## 🎯 Next Steps

**Immediate actions (this week):**
- Get legal counsel's read on the payment structure. This is the gating item.
- Shortlist licensed payment and bill-pay partners.
- Source every placeholder statistic.
- Decide whether the pilot is limited to one city and one biller category.

**Short term (next 2 weeks):**
- Build a clickable prototype of the swipe feed and pay flow.
- Test the redaction approach on 50 real or sample bills.
- Draft the verification checklist with ops.

**Medium term (next month):**
- Finalize technical architecture and engineering design doc
- Sign payment partner agreement
- Recruit pilot payers and bill-holder community partners
