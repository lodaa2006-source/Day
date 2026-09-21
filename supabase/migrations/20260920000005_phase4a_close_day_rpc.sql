-- ==============================================================================
-- SUPABASE MIGRATION: Phase 4A Close Day & Reconciliation RPC
-- Description: Implements atomic closure and reconciliation for an OPEN business day:
--   1. rpc_close_day
--
-- Security:
--   - SECURITY DEFINER
--   - search_path is strictly pinned to 'public, pg_temp'
--   - Requires authenticated caller (auth.uid() IS NOT NULL)
--   - Execution strictly granted to authenticated; revoked from PUBLIC and anon
--   - Direct table INSERT/UPDATE/DELETE remains revoked for authenticated users
--
-- Concurrency & Locking Hierarchy:
--   - 1. Lock day row FIRST (SELECT ... FROM days WHERE id = day_id FOR UPDATE)
--   - 2. Serializes all incoming transactions because transaction RPCs lock the day first
--   - 3. Derive expected closing balance strictly from the ledger (opening + income - expense)
--   - 4. Atomically mark day as CLOSED and record physical counted actual closing balance
-- ==============================================================================

CREATE OR REPLACE FUNCTION rpc_close_day(
  p_day_id TEXT,
  p_actual_closing_cents BIGINT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_trimmed_day_id TEXT;
  v_day_record RECORD;
  v_total_income_cents BIGINT := 0;
  v_total_expense_cents BIGINT := 0;
  v_expected_closing_cents BIGINT := 0;
  v_difference_cents BIGINT := 0;
  v_final_notes TEXT;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. Validate day ID input
  IF p_day_id IS NULL OR trim(p_day_id) = '' THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;
  v_trimmed_day_id := trim(p_day_id);

  -- 3. Lock Order: 1. DAY FIRST
  -- The day row MUST be locked before calculating the final closing state.
  -- This serializes with all transaction creation, update, and deletion operations
  -- which also lock the day row first.
  SELECT
    id,
    business_date,
    status,
    opening_business_balance_cents,
    notes
  INTO v_day_record
  FROM public.days
  WHERE id = v_trimmed_day_id
  FOR UPDATE;

  -- 4. Day existence validation
  IF v_day_record.id IS NULL THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  -- 5. Day status validation (Only OPEN days may be closed)
  IF v_day_record.status <> 'OPEN' THEN
    RAISE EXCEPTION 'ERR_DAY_ALREADY_CLOSED';
  END IF;

  -- 6. Actual closing amount validation (Must be non-negative, zero is valid)
  IF p_actual_closing_cents IS NULL OR p_actual_closing_cents < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_CLOSING_AMOUNT';
  END IF;

  -- 7. Calculate expected closing balance from the ledger
  -- expected_closing_balance = opening_business_balance + total INCOME - total EXPENSE
  -- TRANSFER transactions are internal movements with business impact = 0
  SELECT
    COALESCE(SUM(CASE WHEN transaction_kind = 'INCOME' THEN amount_cents ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_kind = 'EXPENSE' THEN amount_cents ELSE 0 END), 0)
  INTO
    v_total_income_cents,
    v_total_expense_cents
  FROM public.transactions
  WHERE day_id = v_trimmed_day_id;

  v_expected_closing_cents := v_day_record.opening_business_balance_cents + v_total_income_cents - v_total_expense_cents;

  -- 8. Calculate reconciliation difference
  -- difference = actual_closing_balance - expected_closing_balance
  -- difference > 0: Surplus | difference < 0: Deficit | difference = 0: Exact
  v_difference_cents := p_actual_closing_cents - v_expected_closing_cents;

  -- 9. Determine final notes
  IF p_notes IS NOT NULL THEN
    v_final_notes := p_notes;
  ELSE
    v_final_notes := v_day_record.notes;
  END IF;

  -- 10. Atomically update day to CLOSED with actual closing balance
  -- No reconciliation transactions are created. The difference is derived only.
  UPDATE public.days
  SET
    status = 'CLOSED',
    actual_closing_balance_cents = p_actual_closing_cents,
    closed_at = NOW(),
    notes = v_final_notes
  WHERE id = v_trimmed_day_id;

  -- 11. Return JSONB response
  RETURN jsonb_build_object(
    'success', true,
    'day_id', v_trimmed_day_id,
    'status', 'CLOSED',
    'business_date', v_day_record.business_date,
    'opening_business_cents', v_day_record.opening_business_balance_cents,
    'expected_closing_cents', v_expected_closing_cents,
    'actual_closing_cents', p_actual_closing_cents,
    'difference_cents', v_difference_cents,
    'notes', v_final_notes
  );
END;
$$;

-- ==============================================================================
-- PRIVILEGE ASSIGNMENTS FOR PHASE 4A RPC
-- ==============================================================================
REVOKE EXECUTE ON FUNCTION rpc_close_day(TEXT, BIGINT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_close_day(TEXT, BIGINT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION rpc_close_day(TEXT, BIGINT, TEXT) TO authenticated;
