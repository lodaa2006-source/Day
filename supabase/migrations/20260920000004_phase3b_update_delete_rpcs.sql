-- ==============================================================================
-- SUPABASE MIGRATION: Phase 3B Update and Delete Transaction RPCs
-- Description: Implements atomic mutation RPCs for updating and deleting transactions:
--   1. rpc_update_transaction
--   2. rpc_delete_transaction
--
-- Security:
--   - All functions are SECURITY DEFINER
--   - search_path is strictly pinned to 'public, pg_temp'
--   - Requires authenticated caller (auth.uid() IS NOT NULL)
--   - Execution strictly granted to authenticated; revoked from PUBLIC and anon
--   - Direct table INSERT/UPDATE/DELETE remains revoked for authenticated users
--
-- Concurrency & Locking Hierarchy:
--   - 1. Lock day row FIRST (SELECT ... FROM days WHERE id = day_id FOR UPDATE)
--   - 2. Read old machine references
--   - 3. Determine UNION of old and new affected machine IDs
--   - 4. Lock ALL affected machines in deterministic ASCENDING ID order
--   - 5. Lock transaction row (SELECT ... FROM transactions WHERE id = tx_id FOR UPDATE)
--   - 6. Re-read transaction state after acquiring row lock
--   - 7. Compute derived balance excluding old transaction + new effect
--   - 8. Execute in-place mutation or deletion
-- ==============================================================================

-- ==============================================================================
-- 1. rpc_update_transaction
-- Updates an existing transaction in place with full semantic and balance validation.
-- Supports all 9 transitions:
--   INCOME -> INCOME, INCOME -> EXPENSE, INCOME -> TRANSFER,
--   EXPENSE -> INCOME, EXPENSE -> EXPENSE, EXPENSE -> TRANSFER,
--   TRANSFER -> INCOME, TRANSFER -> EXPENSE, TRANSFER -> TRANSFER
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_update_transaction(
  p_tx_id TEXT,
  p_new_kind VARCHAR,
  p_new_amount BIGINT,
  p_new_category TEXT,
  p_new_desc TEXT,
  p_new_source_id TEXT,
  p_new_dest_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_trimmed_tx_id TEXT;
  v_new_kind VARCHAR(20);
  v_new_source_id TEXT;
  v_new_dest_id TEXT;
  v_day_id TEXT;
  v_day_status VARCHAR(10);
  v_old_kind VARCHAR(20);
  v_old_amount BIGINT;
  v_old_source_id TEXT;
  v_old_dest_id TEXT;
  v_locked_day_id TEXT;
  v_source_active BOOLEAN;
  v_dest_active BOOLEAN;
  r_machine RECORD;
  v_m_opening BIGINT;
  v_m_income BIGINT;
  v_m_expense BIGINT;
  v_m_trf_in BIGINT;
  v_m_trf_out BIGINT;
  v_m_base_balance BIGINT;
  v_m_new_effect BIGINT;
  v_m_post_balance BIGINT;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. Validate transaction ID input
  IF p_tx_id IS NULL OR trim(p_tx_id) = '' THEN
    RAISE EXCEPTION 'ERR_TRANSACTION_NOT_FOUND';
  END IF;
  v_trimmed_tx_id := trim(p_tx_id);

  -- 3. Validate new transaction parameters
  IF p_new_kind IS NULL OR trim(p_new_kind) = '' THEN
    RAISE EXCEPTION 'ERR_INVALID_TRANSACTION_KIND';
  END IF;
  v_new_kind := trim(p_new_kind);

  IF v_new_kind NOT IN ('INCOME', 'EXPENSE', 'TRANSFER') THEN
    RAISE EXCEPTION 'ERR_INVALID_TRANSACTION_KIND';
  END IF;

  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_AMOUNT';
  END IF;

  IF p_new_category IS NULL OR trim(p_new_category) = '' THEN
    RAISE EXCEPTION 'ERR_INVALID_CATEGORY';
  END IF;

  v_new_source_id := NULLIF(trim(p_new_source_id), '');
  v_new_dest_id := NULLIF(trim(p_new_dest_id), '');

  -- 4. Validate kind-specific semantics
  IF v_new_kind = 'INCOME' THEN
    IF v_new_source_id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_TRANSACTION_SEMANTICS';
    END IF;
    IF v_new_dest_id IS NULL THEN
      RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
    END IF;
  ELSIF v_new_kind = 'EXPENSE' THEN
    IF v_new_source_id IS NULL THEN
      RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
    END IF;
    IF v_new_dest_id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_TRANSACTION_SEMANTICS';
    END IF;
  ELSIF v_new_kind = 'TRANSFER' THEN
    IF v_new_source_id IS NULL OR v_new_dest_id IS NULL THEN
      RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
    END IF;
    IF v_new_source_id = v_new_dest_id THEN
      RAISE EXCEPTION 'ERR_SAME_ACCOUNT_TRANSFER';
    END IF;
  END IF;

  -- 5. Read current transaction to find associated day_id and old machine references
  SELECT day_id, transaction_kind, amount_cents, source_machine_account_id, destination_machine_account_id
  INTO v_day_id, v_old_kind, v_old_amount, v_old_source_id, v_old_dest_id
  FROM transactions
  WHERE id = v_trimmed_tx_id;

  IF v_day_id IS NULL THEN
    RAISE EXCEPTION 'ERR_TRANSACTION_NOT_FOUND';
  END IF;

  -- 6. CRITICAL LOCKING HIERARCHY:
  -- Step 1: Lock the day FIRST
  SELECT status INTO v_day_status FROM days WHERE id = v_day_id FOR UPDATE;

  IF v_day_status IS NULL THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  IF v_day_status <> 'OPEN' THEN
    RAISE EXCEPTION 'ERR_DAY_CLOSED';
  END IF;

  -- Step 2 & 3 & 4: Determine UNION of old and new affected machine IDs and lock in ASCENDING order
  FOR r_machine IN
    SELECT DISTINCT m_id
    FROM unnest(ARRAY[v_old_source_id, v_old_dest_id, v_new_source_id, v_new_dest_id]) AS m_id
    WHERE m_id IS NOT NULL
    ORDER BY m_id ASC
  LOOP
    PERFORM 1 FROM machine_accounts WHERE id = r_machine.m_id FOR UPDATE;
  END LOOP;

  -- Step 5: Lock target transaction row
  SELECT day_id, transaction_kind, amount_cents, source_machine_account_id, destination_machine_account_id
  INTO v_locked_day_id, v_old_kind, v_old_amount, v_old_source_id, v_old_dest_id
  FROM transactions
  WHERE id = v_trimmed_tx_id
  FOR UPDATE;

  IF v_locked_day_id IS NULL THEN
    RAISE EXCEPTION 'ERR_TRANSACTION_NOT_FOUND';
  END IF;

  -- 7. Validate NEW machine references (must exist, be active, and have day opening)
  IF v_new_source_id IS NOT NULL THEN
    SELECT is_active INTO v_source_active FROM machine_accounts WHERE id = v_new_source_id;
    IF v_source_active IS NULL THEN
      RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
    END IF;
    IF NOT v_source_active THEN
      RAISE EXCEPTION 'ERR_ACCOUNT_INACTIVE';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM day_machine_openings WHERE day_id = v_day_id AND machine_account_id = v_new_source_id
    ) THEN
      RAISE EXCEPTION 'ERR_MACHINE_NOT_AVAILABLE_FOR_DAY';
    END IF;
  END IF;

  IF v_new_dest_id IS NOT NULL THEN
    SELECT is_active INTO v_dest_active FROM machine_accounts WHERE id = v_new_dest_id;
    IF v_dest_active IS NULL THEN
      RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
    END IF;
    IF NOT v_dest_active THEN
      RAISE EXCEPTION 'ERR_ACCOUNT_INACTIVE';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM day_machine_openings WHERE day_id = v_day_id AND machine_account_id = v_new_dest_id
    ) THEN
      RAISE EXCEPTION 'ERR_MACHINE_NOT_AVAILABLE_FOR_DAY';
    END IF;
  END IF;

  -- 8. Safe post-update balance validation:
  -- For every affected machine in the union, compute derived balance excluding old transaction + new proposed effect.
  FOR r_machine IN
    SELECT DISTINCT m_id
    FROM unnest(ARRAY[v_old_source_id, v_old_dest_id, v_new_source_id, v_new_dest_id]) AS m_id
    WHERE m_id IS NOT NULL
  LOOP
    SELECT opening_balance_cents INTO v_m_opening
    FROM day_machine_openings
    WHERE day_id = v_day_id AND machine_account_id = r_machine.m_id;

    SELECT
      COALESCE(SUM(CASE WHEN destination_machine_account_id = r_machine.m_id AND transaction_kind = 'INCOME' THEN amount_cents ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN source_machine_account_id = r_machine.m_id AND transaction_kind = 'EXPENSE' THEN amount_cents ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN destination_machine_account_id = r_machine.m_id AND transaction_kind = 'TRANSFER' THEN amount_cents ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN source_machine_account_id = r_machine.m_id AND transaction_kind = 'TRANSFER' THEN amount_cents ELSE 0 END), 0)
    INTO
      v_m_income,
      v_m_expense,
      v_m_trf_in,
      v_m_trf_out
    FROM transactions
    WHERE day_id = v_day_id AND id <> v_trimmed_tx_id;

    v_m_base_balance := COALESCE(v_m_opening, 0) + v_m_income - v_m_expense + v_m_trf_in - v_m_trf_out;

    v_m_new_effect := 0;
    IF v_new_kind = 'INCOME' AND v_new_dest_id = r_machine.m_id THEN
      v_m_new_effect := p_new_amount;
    ELSIF v_new_kind = 'EXPENSE' AND v_new_source_id = r_machine.m_id THEN
      v_m_new_effect := -p_new_amount;
    ELSIF v_new_kind = 'TRANSFER' THEN
      IF v_new_source_id = r_machine.m_id THEN
        v_m_new_effect := v_m_new_effect - p_new_amount;
      END IF;
      IF v_new_dest_id = r_machine.m_id THEN
        v_m_new_effect := v_m_new_effect + p_new_amount;
      END IF;
    END IF;

    v_m_post_balance := v_m_base_balance + v_m_new_effect;

    IF v_m_post_balance < 0 THEN
      RAISE EXCEPTION 'ERR_INSUFFICIENT_FUNDS';
    END IF;
  END LOOP;

  -- 9. Perform in-place update (preserving id, day_id, created_by_user_id, created_at, and timestamp)
  UPDATE transactions
  SET
    transaction_kind = v_new_kind,
    amount_cents = p_new_amount,
    category = trim(p_new_category),
    description = COALESCE(p_new_desc, ''),
    source_machine_account_id = v_new_source_id,
    destination_machine_account_id = v_new_dest_id,
    updated_at = NOW()
  WHERE id = v_trimmed_tx_id;

  -- 10. Return JSONB response
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_trimmed_tx_id,
    'day_id', v_day_id,
    'kind', v_new_kind,
    'amount', p_new_amount,
    'source_id', v_new_source_id,
    'destination_id', v_new_dest_id
  );
END;
$$;

-- ==============================================================================
-- 2. rpc_delete_transaction
-- Deletes an existing transaction from the ledger with strict day and balance protection.
-- Removes the entry directly without creating compensating transactions.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_delete_transaction(
  p_tx_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_trimmed_tx_id TEXT;
  v_day_id TEXT;
  v_day_status VARCHAR(10);
  v_old_kind VARCHAR(20);
  v_old_amount BIGINT;
  v_old_source_id TEXT;
  v_old_dest_id TEXT;
  v_locked_day_id TEXT;
  r_machine RECORD;
  v_m_opening BIGINT;
  v_m_income BIGINT;
  v_m_expense BIGINT;
  v_m_trf_in BIGINT;
  v_m_trf_out BIGINT;
  v_m_post_balance BIGINT;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. Validate input
  IF p_tx_id IS NULL OR trim(p_tx_id) = '' THEN
    RAISE EXCEPTION 'ERR_TRANSACTION_NOT_FOUND';
  END IF;
  v_trimmed_tx_id := trim(p_tx_id);

  -- 3. Read current transaction to find day_id and affected machines
  SELECT day_id, transaction_kind, amount_cents, source_machine_account_id, destination_machine_account_id
  INTO v_day_id, v_old_kind, v_old_amount, v_old_source_id, v_old_dest_id
  FROM transactions
  WHERE id = v_trimmed_tx_id;

  IF v_day_id IS NULL THEN
    RAISE EXCEPTION 'ERR_TRANSACTION_NOT_FOUND';
  END IF;

  -- 4. CRITICAL LOCKING HIERARCHY:
  -- Step 1: Lock the day FIRST
  SELECT status INTO v_day_status FROM days WHERE id = v_day_id FOR UPDATE;

  IF v_day_status IS NULL THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  IF v_day_status <> 'OPEN' THEN
    RAISE EXCEPTION 'ERR_DAY_CLOSED';
  END IF;

  -- Step 2 & 3: Lock all affected machines in deterministic ASCENDING order
  FOR r_machine IN
    SELECT DISTINCT m_id
    FROM unnest(ARRAY[v_old_source_id, v_old_dest_id]) AS m_id
    WHERE m_id IS NOT NULL
    ORDER BY m_id ASC
  LOOP
    PERFORM 1 FROM machine_accounts WHERE id = r_machine.m_id FOR UPDATE;
  END LOOP;

  -- Step 4: Lock transaction row
  SELECT day_id, transaction_kind, amount_cents, source_machine_account_id, destination_machine_account_id
  INTO v_locked_day_id, v_old_kind, v_old_amount, v_old_source_id, v_old_dest_id
  FROM transactions
  WHERE id = v_trimmed_tx_id
  FOR UPDATE;

  IF v_locked_day_id IS NULL THEN
    RAISE EXCEPTION 'ERR_TRANSACTION_NOT_FOUND';
  END IF;

  -- 5. Safe post-delete balance validation:
  -- Verify that removing this transaction does not cause any affected machine balance to drop below zero.
  FOR r_machine IN
    SELECT DISTINCT m_id
    FROM unnest(ARRAY[v_old_source_id, v_old_dest_id]) AS m_id
    WHERE m_id IS NOT NULL
  LOOP
    SELECT opening_balance_cents INTO v_m_opening
    FROM day_machine_openings
    WHERE day_id = v_day_id AND machine_account_id = r_machine.m_id;

    SELECT
      COALESCE(SUM(CASE WHEN destination_machine_account_id = r_machine.m_id AND transaction_kind = 'INCOME' THEN amount_cents ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN source_machine_account_id = r_machine.m_id AND transaction_kind = 'EXPENSE' THEN amount_cents ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN destination_machine_account_id = r_machine.m_id AND transaction_kind = 'TRANSFER' THEN amount_cents ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN source_machine_account_id = r_machine.m_id AND transaction_kind = 'TRANSFER' THEN amount_cents ELSE 0 END), 0)
    INTO
      v_m_income,
      v_m_expense,
      v_m_trf_in,
      v_m_trf_out
    FROM transactions
    WHERE day_id = v_day_id AND id <> v_trimmed_tx_id;

    v_m_post_balance := COALESCE(v_m_opening, 0) + v_m_income - v_m_expense + v_m_trf_in - v_m_trf_out;

    IF v_m_post_balance < 0 THEN
      RAISE EXCEPTION 'ERR_INSUFFICIENT_FUNDS';
    END IF;
  END LOOP;

  -- 6. Delete transaction directly
  DELETE FROM transactions WHERE id = v_trimmed_tx_id;

  -- 7. Return JSONB response
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_trimmed_tx_id,
    'day_id', v_day_id,
    'deleted', true
  );
END;
$$;

-- ==============================================================================
-- PRIVILEGE ASSIGNMENTS FOR PHASE 3B RPCS
-- ==============================================================================
REVOKE EXECUTE ON FUNCTION rpc_update_transaction(TEXT, VARCHAR, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_delete_transaction(TEXT) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION rpc_update_transaction(TEXT, VARCHAR, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_delete_transaction(TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION rpc_update_transaction(TEXT, VARCHAR, BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_delete_transaction(TEXT) TO authenticated;
