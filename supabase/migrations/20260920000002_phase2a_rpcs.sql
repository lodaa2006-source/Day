-- ==============================================================================
-- Supabase Database Migration - Phase 2A: Bootstrap & Machine Management RPCs
-- Current Daily Cash Management System
-- ==============================================================================
-- Strictly 5 RPCs:
-- 1. rpc_initialize_first_day
-- 2. rpc_create_machine
-- 3. rpc_rename_machine
-- 4. rpc_set_machine_active
-- 5. rpc_migrate_local_storage
-- ==============================================================================

-- ==============================================================================
-- RPC 1: rpc_initialize_first_day
-- Atomically initializes the very first business day and machine accounts.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_initialize_first_day(
  p_business_date DATE,
  p_opening_business_cents BIGINT,
  p_machine_openings JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_day_id TEXT;
  v_item JSONB;
  v_item_id TEXT;
  v_item_name TEXT;
  v_item_cents BIGINT;
  v_total_machine_cents BIGINT := 0;
  v_has_cash_drawer BOOLEAN := FALSE;
  v_machine_count INT := 0;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. Bootstrap Concurrency Lock (Transaction-level advisory lock)
  PERFORM pg_advisory_xact_lock(746591028374619283);

  -- 3. System must not already be initialized
  IF EXISTS (SELECT 1 FROM days) THEN
    RAISE EXCEPTION 'ERR_SYSTEM_ALREADY_INITIALIZED';
  END IF;

  -- 4. Input validation
  IF p_business_date IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Business date is required';
  END IF;

  IF p_opening_business_cents IS NULL OR p_opening_business_cents < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_AMOUNT: Opening business balance cannot be negative';
  END IF;

  IF p_machine_openings IS NULL OR jsonb_typeof(p_machine_openings) <> 'array' THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Machine openings must be a JSON array';
  END IF;

  -- 5. Validate elements in machine openings payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_machine_openings)
  LOOP
    v_item_id := trim(COALESCE(v_item->>'id', ''));
    v_item_name := trim(COALESCE(v_item->>'name', ''));
    v_item_cents := (v_item->>'opening_balance_cents')::BIGINT;

    IF v_item_id = '' THEN
      RAISE EXCEPTION 'ERR_INVALID_MACHINE: Machine ID cannot be empty';
    END IF;

    IF v_item_name = '' THEN
      RAISE EXCEPTION 'ERR_INVALID_MACHINE: Machine name cannot be empty';
    END IF;

    IF v_item_cents IS NULL OR v_item_cents < 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_AMOUNT: Machine opening balance cannot be negative';
    END IF;

    IF v_item_id = 'm-cash-drawer' THEN
      v_has_cash_drawer := TRUE;
    END IF;

    v_total_machine_cents := v_total_machine_cents + v_item_cents;
    v_machine_count := v_machine_count + 1;
  END LOOP;

  -- 5b. Check for duplicate machine IDs in payload
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_machine_openings) elem
    GROUP BY trim(elem->>'id')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ERR_MACHINE_ALREADY_EXISTS: Duplicate machine ID in payload';
  END IF;

  -- 5c. Check for duplicate machine names in payload
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_machine_openings) elem
    GROUP BY trim(elem->>'name')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ERR_MACHINE_NAME_ALREADY_EXISTS: Duplicate machine name in payload';
  END IF;

  -- 6. Mandatory Cash Drawer check
  IF NOT v_has_cash_drawer THEN
    RAISE EXCEPTION 'ERR_MISSING_CASH_DRAWER';
  END IF;

  -- 7. Opening Sum Mathematical Invariant Check
  IF v_total_machine_cents <> p_opening_business_cents THEN
    RAISE EXCEPTION 'ERR_OPENING_SUM_MISMATCH';
  END IF;

  -- 8. Generate deterministic day ID
  v_day_id := 'day_' || to_char(p_business_date, 'YYYYMMDD');

  -- 9. Insert Day
  INSERT INTO days (
    id,
    business_date,
    status,
    opening_business_balance_cents,
    actual_closing_balance_cents,
    created_at,
    created_by_user_id
  ) VALUES (
    v_day_id,
    p_business_date,
    'OPEN',
    p_opening_business_cents,
    NULL,
    NOW(),
    v_caller_id
  );

  -- 10. Insert Machine Accounts and Day Machine Openings
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_machine_openings)
  LOOP
    v_item_id := trim(v_item->>'id');
    v_item_name := trim(v_item->>'name');
    v_item_cents := (v_item->>'opening_balance_cents')::BIGINT;

    -- Create Machine Account
    INSERT INTO machine_accounts (
      id,
      name,
      initial_balance_cents,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      v_item_id,
      v_item_name,
      v_item_cents,
      TRUE,
      NOW(),
      NOW()
    );

    -- Create Day Machine Opening
    INSERT INTO day_machine_openings (
      day_id,
      machine_account_id,
      opening_balance_cents,
      created_at
    ) VALUES (
      v_day_id,
      v_item_id,
      v_item_cents,
      NOW()
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'day_id', v_day_id,
    'business_date', p_business_date,
    'opening_business_balance_cents', p_opening_business_cents,
    'machine_count', v_machine_count
  );
END;
$$;

-- ==============================================================================
-- RPC 2: rpc_create_machine
-- Creates an empty machine account (balance = 0) after initialization.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_create_machine(
  p_id TEXT,
  p_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_trimmed_id TEXT;
  v_trimmed_name TEXT;
  v_latest_day_id TEXT;
  v_latest_day_status VARCHAR(10);
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  v_trimmed_id := trim(COALESCE(p_id, ''));
  v_trimmed_name := trim(COALESCE(p_name, ''));

  IF v_trimmed_id = '' OR v_trimmed_name = '' THEN
    RAISE EXCEPTION 'ERR_INVALID_MACHINE';
  END IF;

  IF v_trimmed_id = 'm-cash-drawer' THEN
    RAISE EXCEPTION 'ERR_RESERVED_MACHINE_ID';
  END IF;

  -- 2. System must be initialized
  IF NOT EXISTS (SELECT 1 FROM days) THEN
    RAISE EXCEPTION 'ERR_SYSTEM_NOT_INITIALIZED';
  END IF;

  -- 3. Lock Order: Lock latest DAY first (whether OPEN or CLOSED)
  SELECT id, status INTO v_latest_day_id, v_latest_day_status
  FROM days
  ORDER BY business_date DESC
  LIMIT 1
  FOR UPDATE;

  -- 4. Check duplicate ID and name
  IF EXISTS (SELECT 1 FROM machine_accounts WHERE id = v_trimmed_id) THEN
    RAISE EXCEPTION 'ERR_MACHINE_ALREADY_EXISTS';
  END IF;

  IF EXISTS (SELECT 1 FROM machine_accounts WHERE name = v_trimmed_name) THEN
    RAISE EXCEPTION 'ERR_MACHINE_NAME_ALREADY_EXISTS';
  END IF;

  -- 5. Insert new machine account with initial_balance_cents = 0 (no money created)
  INSERT INTO machine_accounts (
    id,
    name,
    initial_balance_cents,
    is_active,
    created_at,
    updated_at
  ) VALUES (
    v_trimmed_id,
    v_trimmed_name,
    0,
    TRUE,
    NOW(),
    NOW()
  );

  -- 6. If the latest day is OPEN, insert a 0 opening for this machine
  IF v_latest_day_id IS NOT NULL AND v_latest_day_status = 'OPEN' THEN
    INSERT INTO day_machine_openings (
      day_id,
      machine_account_id,
      opening_balance_cents,
      created_at
    ) VALUES (
      v_latest_day_id,
      v_trimmed_id,
      0,
      NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'machine_id', v_trimmed_id,
    'name', v_trimmed_name,
    'initial_balance_cents', 0,
    'is_active', true
  );
END;
$$;

-- ==============================================================================
-- RPC 3: rpc_rename_machine
-- Renames an existing machine without altering any financial balances.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_rename_machine(
  p_id TEXT,
  p_new_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_trimmed_id TEXT;
  v_trimmed_name TEXT;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  v_trimmed_id := trim(COALESCE(p_id, ''));
  v_trimmed_name := trim(COALESCE(p_new_name, ''));

  IF v_trimmed_id = '' OR v_trimmed_name = '' THEN
    RAISE EXCEPTION 'ERR_INVALID_MACHINE';
  END IF;

  -- 2. Lock Order: MACHINE lock FOR UPDATE
  PERFORM 1
  FROM machine_accounts
  WHERE id = v_trimmed_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_MACHINE_NOT_FOUND';
  END IF;

  -- 3. Check duplicate name among other machines
  IF EXISTS (
    SELECT 1 FROM machine_accounts
    WHERE name = v_trimmed_name AND id <> v_trimmed_id
  ) THEN
    RAISE EXCEPTION 'ERR_MACHINE_NAME_ALREADY_EXISTS';
  END IF;

  -- 4. Update machine name
  UPDATE machine_accounts
  SET name = v_trimmed_name,
      updated_at = NOW()
  WHERE id = v_trimmed_id;

  RETURN jsonb_build_object(
    'success', true,
    'machine_id', v_trimmed_id,
    'new_name', v_trimmed_name
  );
END;
$$;

-- ==============================================================================
-- RPC 4: rpc_set_machine_active
-- Activates or deactivates a machine account.
-- Cash drawer can NEVER be deactivated.
-- Deactivation is prohibited if current derived balance <> 0.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_set_machine_active(
  p_id TEXT,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_trimmed_id TEXT;
  v_latest_day_id TEXT;
  v_latest_day_status VARCHAR(10);
  v_opening BIGINT := 0;
  v_income BIGINT := 0;
  v_expense BIGINT := 0;
  v_transfer_in BIGINT := 0;
  v_transfer_out BIGINT := 0;
  v_current_balance BIGINT := 0;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  v_trimmed_id := trim(COALESCE(p_id, ''));
  IF v_trimmed_id = '' THEN
    RAISE EXCEPTION 'ERR_INVALID_MACHINE';
  END IF;

  -- 2. Cash Drawer cannot be deactivated
  IF v_trimmed_id = 'm-cash-drawer' AND p_is_active = FALSE THEN
    RAISE EXCEPTION 'ERR_CANNOT_DISABLE_CASH_DRAWER';
  END IF;

  -- 3. Lock Order: Lock latest DAY first (if any exists)
  SELECT id, status INTO v_latest_day_id, v_latest_day_status
  FROM days
  ORDER BY business_date DESC
  LIMIT 1
  FOR UPDATE;

  -- 4. Lock MACHINE row
  PERFORM 1
  FROM machine_accounts
  WHERE id = v_trimmed_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_MACHINE_NOT_FOUND';
  END IF;

  -- 5. Deactivation verification: derived balance must be exactly 0
  IF p_is_active = FALSE AND v_latest_day_id IS NOT NULL THEN
    SELECT COALESCE(opening_balance_cents, 0)
    INTO v_opening
    FROM day_machine_openings
    WHERE day_id = v_latest_day_id AND machine_account_id = v_trimmed_id;

    SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_income
    FROM transactions
    WHERE day_id = v_latest_day_id
      AND destination_machine_account_id = v_trimmed_id
      AND transaction_kind = 'INCOME';

    SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_expense
    FROM transactions
    WHERE day_id = v_latest_day_id
      AND source_machine_account_id = v_trimmed_id
      AND transaction_kind = 'EXPENSE';

    SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_transfer_in
    FROM transactions
    WHERE day_id = v_latest_day_id
      AND destination_machine_account_id = v_trimmed_id
      AND transaction_kind = 'TRANSFER';

    SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_transfer_out
    FROM transactions
    WHERE day_id = v_latest_day_id
      AND source_machine_account_id = v_trimmed_id
      AND transaction_kind = 'TRANSFER';

    v_current_balance := v_opening + v_income - v_expense + v_transfer_in - v_transfer_out;

    IF v_current_balance <> 0 THEN
      RAISE EXCEPTION 'ERR_MACHINE_BALANCE_NOT_ZERO';
    END IF;
  END IF;

  -- 6. If activating during an OPEN day and no opening row exists, create with 0
  IF p_is_active = TRUE AND v_latest_day_id IS NOT NULL AND v_latest_day_status = 'OPEN' THEN
    INSERT INTO day_machine_openings (
      day_id,
      machine_account_id,
      opening_balance_cents,
      created_at
    ) VALUES (
      v_latest_day_id,
      v_trimmed_id,
      0,
      NOW()
    )
    ON CONFLICT (day_id, machine_account_id) DO NOTHING;
  END IF;

  -- 7. Update is_active
  UPDATE machine_accounts
  SET is_active = p_is_active,
      updated_at = NOW()
  WHERE id = v_trimmed_id;

  RETURN jsonb_build_object(
    'success', true,
    'machine_id', v_trimmed_id,
    'is_active', p_is_active
  );
END;
$$;

-- ==============================================================================
-- RPC 5: rpc_migrate_local_storage
-- One-time atomic migration endpoint from local storage to Supabase.
-- ==============================================================================
CREATE OR REPLACE FUNCTION rpc_migrate_local_storage(
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_machines JSONB;
  v_days JSONB;
  v_openings JSONB;
  v_transactions JSONB;
  v_item JSONB;
  v_has_cash_drawer BOOLEAN := FALSE;
  v_open_days_count INT := 0;
  v_machine_count INT := 0;
  v_day_count INT := 0;
  v_opening_count INT := 0;
  v_tx_count INT := 0;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED';
  END IF;

  -- 2. Bootstrap Concurrency Lock
  PERFORM pg_advisory_xact_lock(746591028374619283);

  -- 3. Migration allowed ONLY if days table is empty
  IF EXISTS (SELECT 1 FROM days) THEN
    RAISE EXCEPTION 'ERR_ALREADY_MIGRATED';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Root payload must be a JSON object';
  END IF;

  v_machines := p_payload->'machines';
  v_days := p_payload->'days';
  v_openings := p_payload->'day_machine_openings';
  v_transactions := p_payload->'transactions';

  IF v_machines IS NULL OR jsonb_typeof(v_machines) <> 'array' THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: machines array is required';
  END IF;

  IF v_days IS NULL OR jsonb_typeof(v_days) <> 'array' THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: days array is required';
  END IF;

  -- Check cash drawer in machines payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_machines)
  LOOP
    IF (v_item->>'id') = 'm-cash-drawer' THEN
      v_has_cash_drawer := TRUE;
    END IF;
  END LOOP;

  IF NOT v_has_cash_drawer THEN
    RAISE EXCEPTION 'ERR_MISSING_CASH_DRAWER';
  END IF;

  -- Check single OPEN day rule across migrated days
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_days)
  LOOP
    IF (v_item->>'status') = 'OPEN' THEN
      v_open_days_count := v_open_days_count + 1;
    END IF;
  END LOOP;

  IF v_open_days_count > 1 THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Only one day may have status OPEN';
  END IF;

  -- 3b. Validate unique machine IDs and names in payload
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_machines) elem
    GROUP BY trim(elem->>'id')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ERR_MACHINE_ALREADY_EXISTS: Duplicate machine ID in migration payload';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_machines) elem
    GROUP BY trim(elem->>'name')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ERR_MACHINE_NAME_ALREADY_EXISTS: Duplicate machine name in migration payload';
  END IF;

  -- 3c. Validate unique day IDs and business dates in payload
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_days) elem
    GROUP BY trim(elem->>'id')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Duplicate day ID in migration payload';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_days) elem
    GROUP BY trim(elem->>'business_date')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Duplicate business_date in migration payload';
  END IF;

  -- 3d. Validate transactions semantics in payload (amount > 0, kind rules, no same-account transfer)
  IF v_transactions IS NOT NULL AND jsonb_typeof(v_transactions) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_transactions)
    LOOP
      IF (v_item->>'amount_cents')::BIGINT <= 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_AMOUNT: Transaction amount must be positive';
      END IF;

      IF (v_item->>'transaction_kind') NOT IN ('INCOME', 'EXPENSE', 'TRANSFER') THEN
        RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Invalid transaction kind';
      END IF;

      IF (v_item->>'transaction_kind') = 'INCOME' THEN
        IF NULLIF(trim(v_item->>'destination_machine_account_id'), '') IS NULL OR NULLIF(trim(v_item->>'source_machine_account_id'), '') IS NOT NULL THEN
          RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Income requires destination account and null source';
        END IF;
      ELSIF (v_item->>'transaction_kind') = 'EXPENSE' THEN
        IF NULLIF(trim(v_item->>'source_machine_account_id'), '') IS NULL OR NULLIF(trim(v_item->>'destination_machine_account_id'), '') IS NOT NULL THEN
          RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Expense requires source account and null destination';
        END IF;
      ELSIF (v_item->>'transaction_kind') = 'TRANSFER' THEN
        IF NULLIF(trim(v_item->>'source_machine_account_id'), '') IS NULL OR NULLIF(trim(v_item->>'destination_machine_account_id'), '') IS NULL THEN
          RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Transfer requires both source and destination accounts';
        END IF;
        IF trim(v_item->>'source_machine_account_id') = trim(v_item->>'destination_machine_account_id') THEN
          RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Same-account transfer is forbidden';
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 4. Insert machines
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_machines)
  LOOP
    INSERT INTO machine_accounts (
      id,
      name,
      initial_balance_cents,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      trim(v_item->>'id'),
      trim(v_item->>'name'),
      COALESCE((v_item->>'initial_balance_cents')::BIGINT, 0),
      COALESCE((v_item->>'is_active')::BOOLEAN, TRUE),
      COALESCE((v_item->>'created_at')::TIMESTAMPTZ, NOW()),
      COALESCE((v_item->>'updated_at')::TIMESTAMPTZ, NOW())
    );
    v_machine_count := v_machine_count + 1;
  END LOOP;

  -- 5. Insert days (created_by_user_id always auth.uid())
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_days)
  LOOP
    INSERT INTO days (
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
      trim(v_item->>'id'),
      (v_item->>'business_date')::DATE,
      v_item->>'status',
      (v_item->>'opening_business_balance_cents')::BIGINT,
      (v_item->>'actual_closing_balance_cents')::BIGINT,
      v_item->>'notes',
      COALESCE((v_item->>'created_at')::TIMESTAMPTZ, NOW()),
      (v_item->>'closed_at')::TIMESTAMPTZ,
      v_caller_id
    );
    v_day_count := v_day_count + 1;
  END LOOP;

  -- 6. Insert day_machine_openings
  IF v_openings IS NOT NULL AND jsonb_typeof(v_openings) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_openings)
    LOOP
      INSERT INTO day_machine_openings (
        day_id,
        machine_account_id,
        opening_balance_cents,
        created_at
      ) VALUES (
        trim(v_item->>'day_id'),
        trim(v_item->>'machine_account_id'),
        (v_item->>'opening_balance_cents')::BIGINT,
        COALESCE((v_item->>'created_at')::TIMESTAMPTZ, NOW())
      );
      v_opening_count := v_opening_count + 1;
    END LOOP;
  END IF;

  -- 7. Insert transactions (created_by_user_id always auth.uid())
  IF v_transactions IS NOT NULL AND jsonb_typeof(v_transactions) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_transactions)
    LOOP
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
        trim(v_item->>'id'),
        trim(v_item->>'day_id'),
        v_item->>'transaction_kind',
        v_item->>'category',
        (v_item->>'amount_cents')::BIGINT,
        COALESCE(v_item->>'description', ''),
        NULLIF(trim(v_item->>'source_machine_account_id'), ''),
        NULLIF(trim(v_item->>'destination_machine_account_id'), ''),
        COALESCE((v_item->>'timestamp')::TIMESTAMPTZ, NOW()),
        COALESCE((v_item->>'created_at')::TIMESTAMPTZ, NOW()),
        COALESCE((v_item->>'updated_at')::TIMESTAMPTZ, NOW()),
        v_caller_id
      );
      v_tx_count := v_tx_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'migrated_machines', v_machine_count,
    'migrated_days', v_day_count,
    'migrated_openings', v_opening_count,
    'migrated_transactions', v_tx_count
  );
END;
$$;

-- ==============================================================================
-- FUNCTION EXECUTION PRIVILEGES
-- Model:
-- anon:          NO EXECUTE
-- authenticated: YES EXECUTE
-- PUBLIC:        NO EXECUTE
-- ==============================================================================
DO $$
BEGIN
  -- Revoke from PUBLIC
  REVOKE EXECUTE ON FUNCTION rpc_initialize_first_day(DATE, BIGINT, JSONB) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION rpc_create_machine(TEXT, TEXT) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION rpc_rename_machine(TEXT, TEXT) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION rpc_set_machine_active(TEXT, BOOLEAN) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION rpc_migrate_local_storage(JSONB) FROM PUBLIC;

  -- Revoke from anon if role exists
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION rpc_initialize_first_day(DATE, BIGINT, JSONB) FROM anon;
    REVOKE EXECUTE ON FUNCTION rpc_create_machine(TEXT, TEXT) FROM anon;
    REVOKE EXECUTE ON FUNCTION rpc_rename_machine(TEXT, TEXT) FROM anon;
    REVOKE EXECUTE ON FUNCTION rpc_set_machine_active(TEXT, BOOLEAN) FROM anon;
    REVOKE EXECUTE ON FUNCTION rpc_migrate_local_storage(JSONB) FROM anon;
  END IF;

  -- Grant to authenticated if role exists
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION rpc_initialize_first_day(DATE, BIGINT, JSONB) TO authenticated;
    GRANT EXECUTE ON FUNCTION rpc_create_machine(TEXT, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION rpc_rename_machine(TEXT, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION rpc_set_machine_active(TEXT, BOOLEAN) TO authenticated;
    GRANT EXECUTE ON FUNCTION rpc_migrate_local_storage(JSONB) TO authenticated;
  END IF;
END $$;
