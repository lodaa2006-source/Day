-- ==============================================================================
-- SUPABASE MIGRATION: Phase 4B Start Next Day RPC
-- Description: Implements atomic business day rollover and machine opening initialization:
--   1. rpc_start_next_day(p_business_date DATE) RETURNS JSONB
--
-- Security:
--   - SECURITY DEFINER
--   - search_path is strictly pinned to 'public, pg_temp'
--   - Requires authenticated caller (auth.uid() IS NOT NULL)
--   - Execution strictly granted to authenticated; revoked from PUBLIC and anon
--   - Direct table INSERT/UPDATE/DELETE remains revoked for authenticated users
--
-- Concurrency & Locking Hierarchy:
--   - 1. Transaction-level advisory lock (746591028374619283) for system-wide rollover serialization
--   - 2. Lock latest DAY row FIRST (SELECT ... FROM days ORDER BY business_date DESC LIMIT 1 FOR UPDATE)
--   - 3. Lock all active machine accounts in deterministic ascending ID order (ORDER BY id ASC FOR UPDATE)
--   - 4. Derive previous expected closing and reconciliation difference
--   - 5. New business opening = previous actual closing
--   - 6. Active machines roll over with their derived closing balances; m-cash-drawer absorbs difference
--   - 7. Insert new day with status = 'OPEN' and insert day_machine_openings for active machines
--   - 8. Zero financial transactions created; previous day records completely immutable
-- ==============================================================================

CREATE OR REPLACE FUNCTION rpc_start_next_day(
  p_business_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_latest_day RECORD;
  v_new_day_id TEXT;
  v_total_income_cents BIGINT := 0;
  v_total_expense_cents BIGINT := 0;
  v_prev_expected_closing_cents BIGINT := 0;
  v_prev_actual_closing_cents BIGINT := 0;
  v_difference_cents BIGINT := 0;
  v_new_opening_business_cents BIGINT := 0;
  v_machine RECORD;
  v_prev_machine_opening BIGINT := 0;
  v_m_income BIGINT := 0;
  v_m_expense BIGINT := 0;
  v_m_transfer_in BIGINT := 0;
  v_m_transfer_out BIGINT := 0;
  v_derived_machine_closing BIGINT := 0;
  v_assigned_machine_opening BIGINT := 0;
  v_machine_openings_json JSONB := '[]'::jsonb;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. System Rollover Concurrency Lock (Transaction-level advisory lock)
  -- Reuses the established Phase 2A system serialization advisory key
  PERFORM pg_advisory_xact_lock(746591028374619283);

  -- 3. Validate existence of previous day
  IF NOT EXISTS (SELECT 1 FROM public.days) THEN
    RAISE EXCEPTION 'ERR_NO_PREVIOUS_DAY';
  END IF;

  -- 4. Lock Order Step 1: Lock latest DAY row first
  SELECT
    id,
    business_date,
    status,
    opening_business_balance_cents,
    actual_closing_balance_cents,
    notes
  INTO v_latest_day
  FROM public.days
  ORDER BY business_date DESC
  LIMIT 1
  FOR UPDATE;

  -- 5. Verify latest day status (Must be CLOSED)
  IF v_latest_day.status = 'OPEN' THEN
    RAISE EXCEPTION 'ERR_LATEST_DAY_NOT_CLOSED';
  END IF;

  -- 6. Verify that no other OPEN day exists in the system
  IF EXISTS (SELECT 1 FROM public.days WHERE status = 'OPEN') THEN
    RAISE EXCEPTION 'ERR_OPEN_DAY_ALREADY_EXISTS';
  END IF;

  -- 7. Validate business date
  IF p_business_date IS NULL OR p_business_date <= v_latest_day.business_date THEN
    RAISE EXCEPTION 'ERR_INVALID_BUSINESS_DATE';
  END IF;

  -- 8. Duplicate date check
  IF EXISTS (SELECT 1 FROM public.days WHERE business_date = p_business_date) THEN
    RAISE EXCEPTION 'ERR_DATE_ALREADY_EXISTS';
  END IF;

  -- 9. Check required active cash drawer account
  IF NOT EXISTS (SELECT 1 FROM public.machine_accounts WHERE id = 'm-cash-drawer' AND is_active = true) THEN
    RAISE EXCEPTION 'ERR_MISSING_CASH_DRAWER';
  END IF;

  -- 10. Lock Order Step 2: Lock all active machine accounts in deterministic ascending ID order
  PERFORM id
  FROM public.machine_accounts
  WHERE is_active = true
  ORDER BY id ASC
  FOR UPDATE;

  -- 11. Calculate previous day expected closing balance and reconciliation difference
  SELECT
    COALESCE(SUM(CASE WHEN transaction_kind = 'INCOME' THEN amount_cents ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_kind = 'EXPENSE' THEN amount_cents ELSE 0 END), 0)
  INTO
    v_total_income_cents,
    v_total_expense_cents
  FROM public.transactions
  WHERE day_id = v_latest_day.id;

  v_prev_expected_closing_cents := v_latest_day.opening_business_balance_cents + v_total_income_cents - v_total_expense_cents;
  v_prev_actual_closing_cents := COALESCE(v_latest_day.actual_closing_balance_cents, 0);
  v_difference_cents := v_prev_actual_closing_cents - v_prev_expected_closing_cents;

  -- 12. Authoritative Business Opening Rollover:
  -- new_day.opening_business_balance_cents = previous_day.actual_closing_balance_cents
  v_new_opening_business_cents := v_prev_actual_closing_cents;

  -- 13. Construct new day ID
  v_new_day_id := 'day-' || to_char(p_business_date, 'YYYYMMDD');

  -- 14. Insert new Day record with status = 'OPEN'
  INSERT INTO public.days (
    id,
    business_date,
    status,
    opening_business_balance_cents,
    actual_closing_balance_cents,
    notes,
    created_at,
    closed_at,
    created_by_user_id
  ) VALUES (
    v_new_day_id,
    p_business_date,
    'OPEN',
    v_new_opening_business_cents,
    NULL,
    NULL,
    NOW(),
    NULL,
    v_caller_id
  );

  -- 15. Derive machine closing balances and create Day Machine Openings
  -- Only ACTIVE machines receive an opening row.
  -- The designated physical cash drawer (m-cash-drawer) absorbs the entire reconciliation difference.
  -- All other active machines roll over with their exact derived closing balances.
  FOR v_machine IN
    SELECT m.id, m.name
    FROM public.machine_accounts m
    WHERE m.is_active = true
    ORDER BY m.id ASC
  LOOP
    -- Get previous day machine opening balance (if none existed, e.g. newly created machine, defaults to 0)
    SELECT COALESCE(opening_balance_cents, 0)
    INTO v_prev_machine_opening
    FROM public.day_machine_openings
    WHERE day_id = v_latest_day.id AND machine_account_id = v_machine.id;

    IF v_prev_machine_opening IS NULL THEN
      v_prev_machine_opening := 0;
    END IF;

    -- Aggregate transaction movements on the previous day for this machine
    SELECT
      COALESCE(SUM(CASE WHEN transaction_kind = 'INCOME' AND destination_machine_account_id = v_machine.id THEN amount_cents ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN transaction_kind = 'EXPENSE' AND source_machine_account_id = v_machine.id THEN amount_cents ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN transaction_kind = 'TRANSFER' AND destination_machine_account_id = v_machine.id THEN amount_cents ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN transaction_kind = 'TRANSFER' AND source_machine_account_id = v_machine.id THEN amount_cents ELSE 0 END), 0)
    INTO
      v_m_income,
      v_m_expense,
      v_m_transfer_in,
      v_m_transfer_out
    FROM public.transactions
    WHERE day_id = v_latest_day.id
      AND (source_machine_account_id = v_machine.id OR destination_machine_account_id = v_machine.id);

    -- Derived closing = previous opening + income - expense + transfer_in - transfer_out
    v_derived_machine_closing := v_prev_machine_opening + v_m_income - v_m_expense + v_m_transfer_in - v_m_transfer_out;

    -- Apply difference absorption rule to cash drawer
    IF v_machine.id = 'm-cash-drawer' THEN
      v_assigned_machine_opening := v_derived_machine_closing + v_difference_cents;
    ELSE
      v_assigned_machine_opening := v_derived_machine_closing;
    END IF;

    -- Insert day machine opening record
    INSERT INTO public.day_machine_openings (
      day_id,
      machine_account_id,
      opening_balance_cents,
      created_at
    ) VALUES (
      v_new_day_id,
      v_machine.id,
      v_assigned_machine_opening,
      NOW()
    );

    -- Append to JSONB response array
    v_machine_openings_json := v_machine_openings_json || jsonb_build_array(
      jsonb_build_object(
        'machine_account_id', v_machine.id,
        'name', v_machine.name,
        'opening_balance_cents', v_assigned_machine_opening
      )
    );
  END LOOP;

  -- 16. Return JSONB payload
  RETURN jsonb_build_object(
    'success', true,
    'day_id', v_new_day_id,
    'business_date', p_business_date,
    'status', 'OPEN',
    'opening_business_cents', v_new_opening_business_cents,
    'previous_day_id', v_latest_day.id,
    'previous_business_date', v_latest_day.business_date,
    'previous_actual_closing_cents', v_prev_actual_closing_cents,
    'reconciliation_adjustment_cents', v_difference_cents,
    'machine_openings', v_machine_openings_json
  );
END;
$$;

-- ==============================================================================
-- PRIVILEGE ASSIGNMENTS FOR PHASE 4B RPC
-- ==============================================================================
REVOKE EXECUTE ON FUNCTION rpc_start_next_day(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_start_next_day(DATE) FROM anon;
GRANT EXECUTE ON FUNCTION rpc_start_next_day(DATE) TO authenticated;
