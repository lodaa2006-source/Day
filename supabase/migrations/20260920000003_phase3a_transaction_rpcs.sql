-- ==============================================================================
-- SUPABASE MIGRATION: Phase 3A Transaction RPCs
-- Description: Implements atomic mutation RPCs for daily financial transactions:
--   1. rpc_add_income
--   2. rpc_add_expense
--   3. rpc_add_transfer
--
-- Security:
--   - All functions are SECURITY DEFINER
--   - search_path is strictly pinned to 'public, pg_temp'
--   - Requires authenticated caller (auth.uid() IS NOT NULL)
--   - Execution strictly granted to authenticated; revoked from PUBLIC and anon
--   - Direct table INSERT/UPDATE/DELETE remains revoked for authenticated users
--
-- Concurrency & Locking:
--   - Strict hierarchical locking: DAY FIRST -> MACHINE(S) SECOND
--   - Transfers lock machines in deterministic ASCENDING ID order to avoid deadlocks
--   - Transactions only permitted against OPEN days
--   - Authoritative balance is derived exclusively from day_machine_openings + transactions
-- ==============================================================================

-- ==============================================================================
-- 1. rpc_add_income
-- Real money entering the business into a designated machine account.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_add_income(
  p_day_id TEXT,
  p_dest_id TEXT,
  p_amount BIGINT,
  p_category TEXT,
  p_desc TEXT,
  p_timestamp TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_trimmed_day_id TEXT;
  v_trimmed_dest_id TEXT;
  v_day_status VARCHAR(10);
  v_dest_active BOOLEAN;
  v_tx_id TEXT;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. Input validation
  IF p_day_id IS NULL OR trim(p_day_id) = '' THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  IF p_dest_id IS NULL OR trim(p_dest_id) = '' THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_AMOUNT';
  END IF;

  IF p_category IS NULL OR trim(p_category) = '' THEN
    RAISE EXCEPTION 'ERR_INVALID_CATEGORY';
  END IF;

  IF p_timestamp IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_TIMESTAMP';
  END IF;

  v_trimmed_day_id := trim(p_day_id);
  v_trimmed_dest_id := trim(p_dest_id);

  -- 3. Lock Order: 1. DAY FIRST
  SELECT status INTO v_day_status FROM days WHERE id = v_trimmed_day_id FOR UPDATE;

  IF v_day_status IS NULL THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  IF v_day_status <> 'OPEN' THEN
    RAISE EXCEPTION 'ERR_DAY_CLOSED';
  END IF;

  -- 4. Lock Order: 2. DESTINATION MACHINE SECOND
  SELECT is_active INTO v_dest_active
  FROM machine_accounts
  WHERE id = v_trimmed_dest_id
  FOR UPDATE;

  IF v_dest_active IS NULL THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
  END IF;

  IF NOT v_dest_active THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_INACTIVE';
  END IF;

  -- 5. Verify machine has an opening row for this day
  IF NOT EXISTS (
    SELECT 1 FROM day_machine_openings
    WHERE day_id = v_trimmed_day_id AND machine_account_id = v_trimmed_dest_id
  ) THEN
    RAISE EXCEPTION 'ERR_MACHINE_NOT_AVAILABLE_FOR_DAY';
  END IF;

  -- 6. Insert transaction
  v_tx_id := 'tx_' || gen_random_uuid()::text;

  INSERT INTO transactions (
    id,
    day_id,
    transaction_kind,
    category,
    amount_cents,
    description,
    source_machine_account_id,
    destination_machine_account_id,
    timestamp,
    created_at,
    updated_at,
    created_by_user_id
  ) VALUES (
    v_tx_id,
    v_trimmed_day_id,
    'INCOME',
    trim(p_category),
    p_amount,
    COALESCE(p_desc, ''),
    NULL,
    v_trimmed_dest_id,
    p_timestamp,
    NOW(),
    NOW(),
    v_caller_id
  );

  -- 7. Return result JSONB with response metadata
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'transaction_kind', 'INCOME',
    'day_id', v_trimmed_day_id,
    'destination_machine_account_id', v_trimmed_dest_id,
    'amount_cents', p_amount,
    'business_effect_cents', p_amount,
    'machine_effect_cents', p_amount
  );
END;
$$;

-- ==============================================================================
-- 2. rpc_add_expense
-- Real money leaving the business from a designated machine account.
-- Checks derived machine balance; rejects if insufficient funds.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_add_expense(
  p_day_id TEXT,
  p_source_id TEXT,
  p_amount BIGINT,
  p_category TEXT,
  p_desc TEXT,
  p_timestamp TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_trimmed_day_id TEXT;
  v_trimmed_source_id TEXT;
  v_day_status VARCHAR(10);
  v_source_active BOOLEAN;
  v_opening_balance BIGINT;
  v_income BIGINT;
  v_expense BIGINT;
  v_transfer_in BIGINT;
  v_transfer_out BIGINT;
  v_current_balance BIGINT;
  v_tx_id TEXT;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. Input validation
  IF p_day_id IS NULL OR trim(p_day_id) = '' THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  IF p_source_id IS NULL OR trim(p_source_id) = '' THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_AMOUNT';
  END IF;

  IF p_category IS NULL OR trim(p_category) = '' THEN
    RAISE EXCEPTION 'ERR_INVALID_CATEGORY';
  END IF;

  IF p_timestamp IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_TIMESTAMP';
  END IF;

  v_trimmed_day_id := trim(p_day_id);
  v_trimmed_source_id := trim(p_source_id);

  -- 3. Lock Order: 1. DAY FIRST
  SELECT status INTO v_day_status FROM days WHERE id = v_trimmed_day_id FOR UPDATE;

  IF v_day_status IS NULL THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  IF v_day_status <> 'OPEN' THEN
    RAISE EXCEPTION 'ERR_DAY_CLOSED';
  END IF;

  -- 4. Lock Order: 2. SOURCE MACHINE SECOND
  SELECT is_active INTO v_source_active
  FROM machine_accounts
  WHERE id = v_trimmed_source_id
  FOR UPDATE;

  IF v_source_active IS NULL THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
  END IF;

  IF NOT v_source_active THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_INACTIVE';
  END IF;

  -- 5. Verify machine has an opening row for this day
  SELECT opening_balance_cents INTO v_opening_balance
  FROM day_machine_openings
  WHERE day_id = v_trimmed_day_id AND machine_account_id = v_trimmed_source_id;

  IF v_opening_balance IS NULL THEN
    RAISE EXCEPTION 'ERR_MACHINE_NOT_AVAILABLE_FOR_DAY';
  END IF;

  -- 6. Derive current balance inside transaction
  SELECT
    COALESCE(SUM(CASE WHEN destination_machine_account_id = v_trimmed_source_id AND transaction_kind = 'INCOME' THEN amount_cents ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN source_machine_account_id = v_trimmed_source_id AND transaction_kind = 'EXPENSE' THEN amount_cents ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN destination_machine_account_id = v_trimmed_source_id AND transaction_kind = 'TRANSFER' THEN amount_cents ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN source_machine_account_id = v_trimmed_source_id AND transaction_kind = 'TRANSFER' THEN amount_cents ELSE 0 END), 0)
  INTO
    v_income,
    v_expense,
    v_transfer_in,
    v_transfer_out
  FROM transactions
  WHERE day_id = v_trimmed_day_id;

  v_current_balance := v_opening_balance + v_income - v_expense + v_transfer_in - v_transfer_out;

  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_FUNDS';
  END IF;

  -- 7. Insert transaction
  v_tx_id := 'tx_' || gen_random_uuid()::text;

  INSERT INTO transactions (
    id,
    day_id,
    transaction_kind,
    category,
    amount_cents,
    description,
    source_machine_account_id,
    destination_machine_account_id,
    timestamp,
    created_at,
    updated_at,
    created_by_user_id
  ) VALUES (
    v_tx_id,
    v_trimmed_day_id,
    'EXPENSE',
    trim(p_category),
    p_amount,
    COALESCE(p_desc, ''),
    v_trimmed_source_id,
    NULL,
    p_timestamp,
    NOW(),
    NOW(),
    v_caller_id
  );

  -- 8. Return result JSONB with response metadata
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'transaction_kind', 'EXPENSE',
    'day_id', v_trimmed_day_id,
    'source_machine_account_id', v_trimmed_source_id,
    'amount_cents', p_amount,
    'business_effect_cents', -p_amount,
    'machine_effect_cents', -p_amount
  );
END;
$$;

-- ==============================================================================
-- 3. rpc_add_transfer
-- Internal movement between two business accounts.
-- Deterministic ASCENDING ID machine locking prevents deadlocks.
-- Business total is completely unchanged.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_add_transfer(
  p_day_id TEXT,
  p_source_id TEXT,
  p_dest_id TEXT,
  p_amount BIGINT,
  p_category TEXT,
  p_desc TEXT,
  p_timestamp TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_trimmed_day_id TEXT;
  v_trimmed_source_id TEXT;
  v_trimmed_dest_id TEXT;
  v_day_status VARCHAR(10);
  v_first_machine_id TEXT;
  v_second_machine_id TEXT;
  v_source_active BOOLEAN;
  v_dest_active BOOLEAN;
  v_source_opening BIGINT;
  v_income BIGINT;
  v_expense BIGINT;
  v_transfer_in BIGINT;
  v_transfer_out BIGINT;
  v_source_balance BIGINT;
  v_tx_id TEXT;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. Input validation
  IF p_day_id IS NULL OR trim(p_day_id) = '' THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  IF p_source_id IS NULL OR trim(p_source_id) = '' THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
  END IF;

  IF p_dest_id IS NULL OR trim(p_dest_id) = '' THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
  END IF;

  v_trimmed_day_id := trim(p_day_id);
  v_trimmed_source_id := trim(p_source_id);
  v_trimmed_dest_id := trim(p_dest_id);

  IF v_trimmed_source_id = v_trimmed_dest_id THEN
    RAISE EXCEPTION 'ERR_SAME_ACCOUNT_TRANSFER';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_AMOUNT';
  END IF;

  IF p_category IS NULL OR trim(p_category) = '' THEN
    RAISE EXCEPTION 'ERR_INVALID_CATEGORY';
  END IF;

  IF p_timestamp IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_TIMESTAMP';
  END IF;

  -- 3. Lock Order: 1. DAY FIRST
  SELECT status INTO v_day_status FROM days WHERE id = v_trimmed_day_id FOR UPDATE;

  IF v_day_status IS NULL THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  IF v_day_status <> 'OPEN' THEN
    RAISE EXCEPTION 'ERR_DAY_CLOSED';
  END IF;

  -- 4. Lock Order: 2. MACHINES IN DETERMINISTIC ASCENDING ID ORDER
  IF v_trimmed_source_id < v_trimmed_dest_id THEN
    v_first_machine_id := v_trimmed_source_id;
    v_second_machine_id := v_trimmed_dest_id;
  ELSE
    v_first_machine_id := v_trimmed_dest_id;
    v_second_machine_id := v_trimmed_source_id;
  END IF;

  -- Lock machines in deterministic ascending ID order
  PERFORM 1 FROM machine_accounts WHERE id = v_first_machine_id FOR UPDATE;
  PERFORM 1 FROM machine_accounts WHERE id = v_second_machine_id FOR UPDATE;

  -- Validate existence and active status of both machines
  SELECT is_active INTO v_source_active FROM machine_accounts WHERE id = v_trimmed_source_id;
  SELECT is_active INTO v_dest_active FROM machine_accounts WHERE id = v_trimmed_dest_id;

  IF v_source_active IS NULL OR v_dest_active IS NULL THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
  END IF;

  IF NOT v_source_active OR NOT v_dest_active THEN
    RAISE EXCEPTION 'ERR_ACCOUNT_INACTIVE';
  END IF;

  -- 5. Verify opening rows for both machines
  SELECT opening_balance_cents INTO v_source_opening
  FROM day_machine_openings
  WHERE day_id = v_trimmed_day_id AND machine_account_id = v_trimmed_source_id;

  IF v_source_opening IS NULL THEN
    RAISE EXCEPTION 'ERR_MACHINE_NOT_AVAILABLE_FOR_DAY';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM day_machine_openings
    WHERE day_id = v_trimmed_day_id AND machine_account_id = v_trimmed_dest_id
  ) THEN
    RAISE EXCEPTION 'ERR_MACHINE_NOT_AVAILABLE_FOR_DAY';
  END IF;

  -- 6. Derive source balance inside transaction
  SELECT
    COALESCE(SUM(CASE WHEN destination_machine_account_id = v_trimmed_source_id AND transaction_kind = 'INCOME' THEN amount_cents ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN source_machine_account_id = v_trimmed_source_id AND transaction_kind = 'EXPENSE' THEN amount_cents ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN destination_machine_account_id = v_trimmed_source_id AND transaction_kind = 'TRANSFER' THEN amount_cents ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN source_machine_account_id = v_trimmed_source_id AND transaction_kind = 'TRANSFER' THEN amount_cents ELSE 0 END), 0)
  INTO
    v_income,
    v_expense,
    v_transfer_in,
    v_transfer_out
  FROM transactions
  WHERE day_id = v_trimmed_day_id;

  v_source_balance := v_source_opening + v_income - v_expense + v_transfer_in - v_transfer_out;

  IF v_source_balance < p_amount THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_FUNDS';
  END IF;

  -- 7. Insert transaction
  v_tx_id := 'tx_' || gen_random_uuid()::text;

  INSERT INTO transactions (
    id,
    day_id,
    transaction_kind,
    category,
    amount_cents,
    description,
    source_machine_account_id,
    destination_machine_account_id,
    timestamp,
    created_at,
    updated_at,
    created_by_user_id
  ) VALUES (
    v_tx_id,
    v_trimmed_day_id,
    'TRANSFER',
    trim(p_category),
    p_amount,
    COALESCE(p_desc, ''),
    v_trimmed_source_id,
    v_trimmed_dest_id,
    p_timestamp,
    NOW(),
    NOW(),
    v_caller_id
  );

  -- 8. Return result JSONB with response metadata
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'transaction_kind', 'TRANSFER',
    'day_id', v_trimmed_day_id,
    'source_machine_account_id', v_trimmed_source_id,
    'destination_machine_account_id', v_trimmed_dest_id,
    'amount_cents', p_amount,
    'business_effect_cents', 0,
    'source_machine_effect_cents', -p_amount,
    'destination_machine_effect_cents', p_amount
  );
END;
$$;

-- ==============================================================================
-- PRIVILEGE ASSIGNMENTS FOR PHASE 3A RPCS
-- ==============================================================================
REVOKE EXECUTE ON FUNCTION rpc_add_income(TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_add_expense(TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_add_transfer(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION rpc_add_income(TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_add_expense(TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_add_transfer(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ) FROM anon;

GRANT EXECUTE ON FUNCTION rpc_add_income(TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_add_expense(TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_add_transfer(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
