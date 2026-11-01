-- Bill Swipe core schema — transcribed from docs/PRD.md § "Core Data Model".
-- NOTE (engineering review): `INDEX` inside CREATE TABLE is MySQL syntax and is
-- invalid in PostgreSQL; indexes are split into separate CREATE INDEX statements
-- below. Everything else matches the PRD one-to-one.
-- Money is integer cents. No balances are held by Bill Swipe (see payments table comment).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(20) NOT NULL CHECK (role IN ('holder', 'payer', 'verifier')),
    handle VARCHAR(60) UNIQUE,                -- generated, e.g. "anonymous donor" / "Maya R."
    phone_e164 TEXT UNIQUE,
    email TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);

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
    original_image_key TEXT,           -- encrypted, restricted access (Verification role + access logs)
    story TEXT,
    status VARCHAR(20) DEFAULT 'pending_review',  -- pending_review, verified, published, partially_funded, paid, rejected, withdrawn
    bill_hash VARCHAR(64) UNIQUE,      -- duplicate detection
    region VARCHAR(50),                -- city/region only
    created_at TIMESTAMP DEFAULT NOW(),
    verified_at TIMESTAMP,
    paid_at TIMESTAMP
);
CREATE INDEX idx_bill_status ON bills (status, created_at);

-- SWIPES
CREATE TABLE swipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id UUID NOT NULL REFERENCES users(id),
    bill_id UUID NOT NULL REFERENCES bills(id),
    action VARCHAR(10) NOT NULL,       -- pay, pass, save
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(payer_id, bill_id)
);
CREATE INDEX idx_payer_swipes ON swipes (payer_id, created_at DESC);

-- PAYMENTS (ledger; no balances held)
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES bills(id),
    payer_id UUID NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL,
    partner_txn_id VARCHAR(255) UNIQUE,
    status VARCHAR(20) NOT NULL,       -- authorized, captured, sent_to_biller, confirmed, failed, reversed
    biller_confirmation VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_bill_payments ON payments (bill_id);

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
