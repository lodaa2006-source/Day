-- ==============================================================================
-- SUPABASE MIGRATION: Phase 4B Manual Day Management RPCs
-- Description:
--   1. rpc_start_next_day(p_business_date DATE, p_opening_business_cents BIGINT, p_machine_openings JSONB)
--      Atomically creates the next business day with MANUALLY SUPPLIED opening balance
--      and MANUALLY SUPPLIED machine opening allocations.
--      Zero automatic rollover of closing balance, expected balance, machine balances,
--      or reconciliation difference.
--
--   2. rpc_set_opening_balance(p_day_id TEXT, p_new_opening_business_cents BIGINT, p_machine_openings JSONB)
--      Atomically corrects the opening balance of the CURRENT OPEN day.
--      Preserves all existing transactions untouched.
--      Strictly rejects closed days with ERR_DAY_CLOSED.
--
-- Security:
--   - SECURITY DEFINER
--   - search_path is strictly pinned to 'public, pg_temp'
--   - Requires authenticated caller (auth.uid() IS NOT NULL)
--   - Execution strictly granted to authenticated; revoked from PUBLIC and anon
--   - Direct table INSERT/UPDATE/DELETE remains revoked for authenticated users
--
-- Concurrency & Locking Hierarchy:
--   - Advisory lock (746591028374619283) for day creation serialization
--   - Lock DAY row first FOR UPDATE
--   - Lock active machine accounts in deterministic ascending ID order (ORDER BY id ASC FOR UPDATE)
-- ==============================================================================

-- Drop obsolete single-parameter version to avoid overloading conflicts
DROP FUNCTION IF EXISTS rpc_start_next_day(DATE);

CREATE OR REPLACE FUNCTION rpc_start_next_day(
  p_business_date DATE,
  p_opening_business_cents BIGINT,
  p_machine_openings JSONB DEFAULT '[]'::jsonb
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
  v_machine RECORD;
  v_item JSONB;
  v_item_id TEXT;
  v_item_cents BIGINT;
  v_total_allocated_cents BIGINT := 0;
  v_machine_openings_json JSONB := '[]'::jsonb;
  v_assigned_cents BIGINT;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. System Day Management Concurrency Lock (Transaction-level advisory lock)
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

  -- 6. Verify that latest day has an explicitly recorded actual closing balance (Cannot be NULL)
  IF v_latest_day.actual_closing_balance_cents IS NULL THEN
    RAISE EXCEPTION 'ERR_MISSING_ACTUAL_CLOSING';
  END IF;

  -- 7. Verify that no other OPEN day exists in the system
  IF EXISTS (SELECT 1 FROM public.days WHERE status = 'OPEN') THEN
    RAISE EXCEPTION 'ERR_OPEN_DAY_ALREADY_EXISTS';
  END IF;

  -- 8. Validate business date
  IF p_business_date IS NULL OR p_business_date <= v_latest_day.business_date THEN
    RAISE EXCEPTION 'ERR_INVALID_BUSINESS_DATE';
  END IF;

  -- 9. Duplicate date check
  IF EXISTS (SELECT 1 FROM public.days WHERE business_date = p_business_date) THEN
    RAISE EXCEPTION 'ERR_DATE_ALREADY_EXISTS';
  END IF;

  -- 10. Validate manual opening business balance
  IF p_opening_business_cents IS NULL OR p_opening_business_cents < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_AMOUNT';
  END IF;

  -- 11. Check required active cash drawer account
  IF NOT EXISTS (SELECT 1 FROM public.machine_accounts WHERE id = 'm-cash-drawer' AND is_active = true) THEN
    RAISE EXCEPTION 'ERR_MISSING_CASH_DRAWER';
  END IF;

  -- 12. Lock Order Step 2: Lock all active machine accounts in deterministic ascending ID order
  PERFORM id
  FROM public.machine_accounts
  WHERE is_active = true
  ORDER BY id ASC
  FOR UPDATE;

  -- 13. Validate machine openings array payload (if provided)
  IF p_machine_openings IS NOT NULL AND jsonb_typeof(p_machine_openings) = 'array' THEN
    -- Check for duplicate machine IDs in payload
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_machine_openings) elem
      GROUP BY trim(COALESCE(elem->>'id', elem->>'machine_account_id', ''))
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'ERR_DUPLICATE_MACHINE_OPENING';
    END IF;

    -- Validate each specified machine
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_machine_openings)
    LOOP
      v_item_id := trim(COALESCE(v_item->>'id', v_item->>'machine_account_id', ''));
      v_item_cents := (v_item->>'opening_balance_cents')::BIGINT;

      IF v_item_id = '' THEN
        RAISE EXCEPTION 'ERR_INVALID_MACHINE';
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.machine_accounts WHERE id = v_item_id AND is_active = true) THEN
        RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
      END IF;

      IF v_item_cents IS NULL OR v_item_cents < 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_AMOUNT';
      END IF;

      v_total_allocated_cents := v_total_allocated_cents + v_item_cents;
    END LOOP;
  END IF;

  -- 14. Enforce Opening Allocation Invariant: SUM(machine allocations) <= business opening
  IF v_total_allocated_cents > p_opening_business_cents THEN
    RAISE EXCEPTION 'ERR_OPENING_SUM_EXCEEDS_BUSINESS';
  END IF;

  -- 15. Construct new day ID
  v_new_day_id := 'day-' || to_char(p_business_date, 'YYYYMMDD');

  -- 16. Insert new Day record with status = 'OPEN' and manual opening balance
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
    p_opening_business_cents,
    NULL,
    NULL,
    NOW(),
    NULL,
    v_caller_id
  );

  -- 17. Create Day Machine Openings for ALL active machines
  -- If machine was specified in p_machine_openings, use that explicit amount.
  -- Otherwise, default to 0 cents.
  FOR v_machine IN
    SELECT m.id, m.name
    FROM public.machine_accounts m
    WHERE m.is_active = true
    ORDER BY m.id ASC
  LOOP
    v_assigned_cents := 0;

    IF p_machine_openings IS NOT NULL AND jsonb_typeof(p_machine_openings) = 'array' THEN
      SELECT COALESCE((elem->>'opening_balance_cents')::BIGINT, 0)
      INTO v_assigned_cents
      FROM jsonb_array_elements(p_machine_openings) elem
      WHERE trim(COALESCE(elem->>'id', elem->>'machine_account_id', '')) = v_machine.id
      LIMIT 1;

      IF v_assigned_cents IS NULL THEN
        v_assigned_cents := 0;
      END IF;
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
      v_assigned_cents,
      NOW()
    );

    -- Append to JSONB response array
    v_machine_openings_json := v_machine_openings_json || jsonb_build_array(
      jsonb_build_object(
        'machine_account_id', v_machine.id,
        'name', v_machine.name,
        'opening_balance_cents', v_assigned_cents
      )
    );
  END LOOP;

  -- 18. Return JSONB payload
  RETURN jsonb_build_object(
    'success', true,
    'day_id', v_new_day_id,
    'business_date', p_business_date,
    'status', 'OPEN',
    'opening_business_cents', p_opening_business_cents,
    'total_allocated_cents', v_total_allocated_cents,
    'unallocated_cash_cents', p_opening_business_cents - v_total_allocated_cents,
    'machine_openings', v_machine_openings_json
  );
END;
$$;

-- ==============================================================================
-- PRIVILEGES FOR rpc_start_next_day
-- ==============================================================================
REVOKE EXECUTE ON FUNCTION rpc_start_next_day(DATE, BIGINT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_start_next_day(DATE, BIGINT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION rpc_start_next_day(DATE, BIGINT, JSONB) TO authenticated;


-- ==============================================================================
-- RPC: rpc_set_opening_balance
-- Modifies the opening business balance (and optionally machine allocations)
-- of the CURRENT OPEN day only.
-- Strict immutability for CLOSED days. Existing transactions remain 100% untouched.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_set_opening_balance(
  p_day_id TEXT,
  p_new_opening_business_cents BIGINT,
  p_machine_openings JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_day_record RECORD;
  v_current_allocated BIGINT := 0;
  v_new_allocated BIGINT := 0;
  v_item JSONB;
  v_item_id TEXT;
  v_item_cents BIGINT;
  v_machine RECORD;
  v_assigned_cents BIGINT;
  v_machine_openings_json JSONB := '[]'::jsonb;
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

  IF p_new_opening_business_cents IS NULL OR p_new_opening_business_cents < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_AMOUNT';
  END IF;

  -- 3. Lock target day row FIRST
  SELECT id, business_date, status, opening_business_balance_cents
  INTO v_day_record
  FROM public.days
  WHERE id = trim(p_day_id)
  FOR UPDATE;

  IF v_day_record.id IS NULL THEN
    RAISE EXCEPTION 'ERR_DAY_NOT_FOUND';
  END IF;

  -- 4. Immutability check: Only OPEN days can be modified
  IF v_day_record.status <> 'OPEN' THEN
    RAISE EXCEPTION 'ERR_DAY_CLOSED';
  END IF;

  -- 5. Lock all active machine accounts in ascending order
  PERFORM id
  FROM public.machine_accounts
  WHERE is_active = true
  ORDER BY id ASC
  FOR UPDATE;

  -- 6. Machine allocation handling
  IF p_machine_openings IS NULL THEN
    -- Preserve existing machine opening rows and check against new business opening
    SELECT COALESCE(SUM(opening_balance_cents), 0)
    INTO v_current_allocated
    FROM public.day_machine_openings
    WHERE day_id = v_day_record.id;

    IF p_new_opening_business_cents < v_current_allocated THEN
      RAISE EXCEPTION 'ERR_OPENING_LESS_THAN_ALLOCATED';
    END IF;

    -- Update only business opening balance
    UPDATE public.days
    SET opening_business_balance_cents = p_new_opening_business_cents
    WHERE id = v_day_record.id;

    v_new_allocated := v_current_allocated;

  ELSE
    -- Explicit machine opening updates requested
    IF jsonb_typeof(p_machine_openings) <> 'array' THEN
      RAISE EXCEPTION 'ERR_INVALID_PAYLOAD';
    END IF;

    -- Check for duplicate machine IDs
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_machine_openings) elem
      GROUP BY trim(COALESCE(elem->>'id', elem->>'machine_account_id', ''))
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'ERR_DUPLICATE_MACHINE_OPENING';
    END IF;

    -- Validate each item
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_machine_openings)
    LOOP
      v_item_id := trim(COALESCE(v_item->>'id', v_item->>'machine_account_id', ''));
      v_item_cents := (v_item->>'opening_balance_cents')::BIGINT;

      IF v_item_id = '' THEN
        RAISE EXCEPTION 'ERR_INVALID_MACHINE';
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.machine_accounts WHERE id = v_item_id AND is_active = true) THEN
        RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND';
      END IF;

      IF v_item_cents IS NULL OR v_item_cents < 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_AMOUNT';
      END IF;

      v_new_allocated := v_new_allocated + v_item_cents;
    END LOOP;

    IF v_new_allocated > p_new_opening_business_cents THEN
      RAISE EXCEPTION 'ERR_OPENING_LESS_THAN_ALLOCATED';
    END IF;

    -- Update day opening business balance
    UPDATE public.days
    SET opening_business_balance_cents = p_new_opening_business_cents
    WHERE id = v_day_record.id;

    -- Update day machine openings for each active machine
    FOR v_machine IN
      SELECT m.id, m.name
      FROM public.machine_accounts m
      WHERE m.is_active = true
      ORDER BY m.id ASC
    LOOP
      v_assigned_cents := 0;

      SELECT COALESCE((elem->>'opening_balance_cents')::BIGINT, 0)
      INTO v_assigned_cents
      FROM jsonb_array_elements(p_machine_openings) elem
      WHERE trim(COALESCE(elem->>'id', elem->>'machine_account_id', '')) = v_machine.id
      LIMIT 1;

      IF v_assigned_cents IS NULL THEN
        v_assigned_cents := 0;
      END IF;

      UPDATE public.day_machine_openings
      SET opening_balance_cents = v_assigned_cents
      WHERE day_id = v_day_record.id AND machine_account_id = v_machine.id;

      IF NOT FOUND THEN
        INSERT INTO public.day_machine_openings (
          day_id,
          machine_account_id,
          opening_balance_cents,
          created_at
        ) VALUES (
          v_day_record.id,
          v_machine.id,
          v_assigned_cents,
          NOW()
        );
      END IF;
    END LOOP;
  END IF;

  -- Build machine openings list for response
  FOR v_machine IN
    SELECT dmo.machine_account_id, ma.name, dmo.opening_balance_cents
    FROM public.day_machine_openings dmo
    JOIN public.machine_accounts ma ON ma.id = dmo.machine_account_id
    WHERE dmo.day_id = v_day_record.id
    ORDER BY dmo.machine_account_id ASC
  LOOP
    v_machine_openings_json := v_machine_openings_json || jsonb_build_array(
      jsonb_build_object(
        'machine_account_id', v_machine.machine_account_id,
        'name', v_machine.name,
        'opening_balance_cents', v_machine.opening_balance_cents
      )
    );
  END LOOP;

  -- 7. Return JSONB payload
  RETURN jsonb_build_object(
    'success', true,
    'day_id', v_day_record.id,
    'business_date', v_day_record.business_date,
    'status', 'OPEN',
    'opening_business_balance_cents', p_new_opening_business_cents,
    'allocated_machine_cents', v_new_allocated,
    'unallocated_cash_cents', p_new_opening_business_cents - v_new_allocated,
    'machine_openings', v_machine_openings_json
  );
END;
$$;

-- ==============================================================================
-- PRIVILEGES FOR rpc_set_opening_balance
-- ==============================================================================
REVOKE EXECUTE ON FUNCTION rpc_set_opening_balance(TEXT, BIGINT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_set_opening_balance(TEXT, BIGINT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION rpc_set_opening_balance(TEXT, BIGINT, JSONB) TO authenticated;
