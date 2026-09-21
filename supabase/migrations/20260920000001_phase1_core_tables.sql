-- ==============================================================================
-- Supabase Database Migration - Phase 1: Database Foundation
-- Current Daily Cash Management System
-- ==============================================================================
-- Strictly core tables, constraints, indexes, RLS, and privileges.
-- No RPCs, no triggers, no seed data, no derived stored balances.
-- ==============================================================================

-- Ensure auth schema exists (standard in Supabase)
CREATE SCHEMA IF NOT EXISTS auth;

-- In standard Supabase, auth.users exists. For standalone or test environments,
-- define auth.users reference table if not already present.
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- TABLE 1: days
-- Authoritative daily lifecycle and business opening balance.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS days (
  id TEXT PRIMARY KEY,
  business_date DATE NOT NULL UNIQUE,
  status VARCHAR(10) NOT NULL DEFAULT 'OPEN'
    CONSTRAINT chk_days_status CHECK (status IN ('OPEN', 'CLOSED')),
  opening_business_balance_cents BIGINT NOT NULL
    CONSTRAINT chk_days_opening_balance_non_negative CHECK (opening_business_balance_cents >= 0),
  actual_closing_balance_cents BIGINT NULL
    CONSTRAINT chk_days_actual_closing_balance_valid CHECK (
      actual_closing_balance_cents IS NULL OR actual_closing_balance_cents >= 0
    ),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ NULL,
  created_by_user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT
);

-- Ensure only ONE day can be OPEN at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_days_single_open
  ON days(status)
  WHERE status = 'OPEN';

-- Chronological day lookup index
CREATE INDEX IF NOT EXISTS idx_days_business_date_desc
  ON days(business_date DESC);

-- ==============================================================================
-- TABLE 2: machine_accounts
-- Registry of payment machines and financial sub-accounts.
-- initial_balance_cents is audit/bootstrap metadata only.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS machine_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  initial_balance_cents BIGINT NOT NULL DEFAULT 0
    CONSTRAINT chk_machine_accounts_initial_balance_non_negative CHECK (initial_balance_cents >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- TABLE 3: day_machine_openings
-- Authoritative opening balance of EACH machine for EACH business day.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS day_machine_openings (
  day_id TEXT NOT NULL
    REFERENCES days(id)
    ON DELETE CASCADE,
  machine_account_id TEXT NOT NULL
    REFERENCES machine_accounts(id)
    ON DELETE RESTRICT,
  opening_balance_cents BIGINT NOT NULL
    CONSTRAINT chk_day_machine_openings_balance_non_negative CHECK (opening_balance_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day_id, machine_account_id)
);

-- ==============================================================================
-- TABLE 4: transactions
-- Individual financial mutations with strict semantic constraints.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL
    REFERENCES days(id)
    ON DELETE RESTRICT,
  transaction_kind VARCHAR(15) NOT NULL
    CONSTRAINT chk_transactions_kind CHECK (transaction_kind IN ('INCOME', 'EXPENSE', 'TRANSFER')),
  category TEXT NOT NULL,
  amount_cents BIGINT NOT NULL
    CONSTRAINT chk_transactions_amount_positive CHECK (amount_cents > 0),
  description TEXT NOT NULL DEFAULT '',
  source_machine_account_id TEXT NULL
    REFERENCES machine_accounts(id)
    ON DELETE RESTRICT,
  destination_machine_account_id TEXT NULL
    REFERENCES machine_accounts(id)
    ON DELETE RESTRICT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,
  -- Strict semantic rules per transaction kind
  CONSTRAINT chk_transactions_semantic_rules CHECK (
    (
      transaction_kind = 'INCOME'
      AND destination_machine_account_id IS NOT NULL
      AND source_machine_account_id IS NULL
    )
    OR
    (
      transaction_kind = 'EXPENSE'
      AND source_machine_account_id IS NOT NULL
      AND destination_machine_account_id IS NULL
    )
    OR
    (
      transaction_kind = 'TRANSFER'
      AND source_machine_account_id IS NOT NULL
      AND destination_machine_account_id IS NOT NULL
      AND source_machine_account_id <> destination_machine_account_id
    )
  )
);

-- Daily chronological transaction retrieval index
CREATE INDEX IF NOT EXISTS idx_transactions_day_timestamp_desc
  ON transactions(day_id, timestamp DESC);

-- Source machine lookup index
CREATE INDEX IF NOT EXISTS idx_transactions_source_machine
  ON transactions(source_machine_account_id);

-- Destination machine lookup index
CREATE INDEX IF NOT EXISTS idx_transactions_dest_machine
  ON transactions(destination_machine_account_id);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Core tables protected: authenticated users have SELECT only, anon has NO access.
-- ==============================================================================
ALTER TABLE days ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_machine_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Read policies for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'days' AND policyname = 'Allow authenticated users to read days'
  ) THEN
    CREATE POLICY "Allow authenticated users to read days"
      ON days FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'machine_accounts' AND policyname = 'Allow authenticated users to read machine_accounts'
  ) THEN
    CREATE POLICY "Allow authenticated users to read machine_accounts"
      ON machine_accounts FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'day_machine_openings' AND policyname = 'Allow authenticated users to read day_machine_openings'
  ) THEN
    CREATE POLICY "Allow authenticated users to read day_machine_openings"
      ON day_machine_openings FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Allow authenticated users to read transactions'
  ) THEN
    CREATE POLICY "Allow authenticated users to read transactions"
      ON transactions FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- ==============================================================================
-- TABLE PRIVILEGES
-- Explicit GRANT / REVOKE matrix:
-- anon:          SELECT: NO  | INSERT: NO | UPDATE: NO | DELETE: NO
-- authenticated: SELECT: YES | INSERT: NO | UPDATE: NO | DELETE: NO
-- ==============================================================================
DO $$
BEGIN
  -- Revoke all direct table privileges from PUBLIC and anon roles
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE days FROM anon;
    REVOKE ALL ON TABLE machine_accounts FROM anon;
    REVOKE ALL ON TABLE day_machine_openings FROM anon;
    REVOKE ALL ON TABLE transactions FROM anon;
  END IF;

  REVOKE ALL ON TABLE days FROM PUBLIC;
  REVOKE ALL ON TABLE machine_accounts FROM PUBLIC;
  REVOKE ALL ON TABLE day_machine_openings FROM PUBLIC;
  REVOKE ALL ON TABLE transactions FROM PUBLIC;

  -- Revoke mutation privileges from authenticated role
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE days FROM authenticated;
    REVOKE ALL ON TABLE machine_accounts FROM authenticated;
    REVOKE ALL ON TABLE day_machine_openings FROM authenticated;
    REVOKE ALL ON TABLE transactions FROM authenticated;

    -- Explicitly grant SELECT ONLY to authenticated
    GRANT SELECT ON TABLE days TO authenticated;
    GRANT SELECT ON TABLE machine_accounts TO authenticated;
    GRANT SELECT ON TABLE day_machine_openings TO authenticated;
    GRANT SELECT ON TABLE transactions TO authenticated;
  END IF;
END $$;
