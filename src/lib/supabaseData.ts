import { supabase, isSupabaseConfigured } from './supabase';
import { Day, DayStatus, MachineAccount, Transaction, TransactionKind } from '../types';

export interface SupabaseFinancialData {
  days: Day[];
  machines: MachineAccount[];
  transactions: Transaction[];
  activeDayId: string | null;
}

export interface DayRow {
  id: string;
  business_date: string;
  status: string;
  opening_business_balance_cents: number | string;
  actual_closing_balance_cents: number | string | null;
  created_by_user_id?: string;
  created_at: string;
  closed_at: string | null;
  notes: string | null;
}

export interface DayMachineOpeningRow {
  day_id: string;
  machine_account_id: string;
  opening_balance_cents: number | string;
}

export interface MachineAccountRow {
  id: string;
  name: string;
  initial_balance_cents: number | string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  day_id: string;
  transaction_kind?: string;
  kind?: string;
  amount_cents: number | string;
  category: string;
  description: string | null;
  source_machine_account_id?: string | null;
  source_machine_id?: string | null;
  destination_machine_account_id?: string | null;
  destination_machine_id?: string | null;
  created_by_user_id?: string;
  created_at: string;
  timestamp: string | null;
  updated_at: string;
}

/**
 * Reads all financial data from the 4 public tables in Supabase:
 * - days
 * - machine_accounts
 * - day_machine_openings
 * - transactions
 *
 * Strict read-only operation. Zero writes, zero mutations.
 */
export async function fetchAllFinancialData(): Promise<SupabaseFinancialData | null> {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  // 1. Fetch days
  const daysPromise = supabase
    .from('days')
    .select('id, business_date, status, opening_business_balance_cents, actual_closing_balance_cents, created_by_user_id, created_at, closed_at, notes')
    .order('business_date', { ascending: true });

  // 2. Fetch machine accounts
  const machinesPromise = supabase
    .from('machine_accounts')
    .select('id, name, initial_balance_cents, is_active, created_at, updated_at')
    .order('created_at', { ascending: true });

  // 3. Fetch day machine openings
  const openingsPromise = supabase
    .from('day_machine_openings')
    .select('day_id, machine_account_id, opening_balance_cents');

  // 4. Fetch transactions
  const transactionsPromise = supabase
    .from('transactions')
    .select('id, day_id, transaction_kind, amount_cents, category, description, source_machine_account_id, destination_machine_account_id, created_by_user_id, created_at, timestamp, updated_at')
    .order('timestamp', { ascending: false });

  const [daysRes, machinesRes, openingsRes, txRes] = await Promise.all([
    daysPromise,
    machinesPromise,
    openingsPromise,
    transactionsPromise,
  ]);

  if (daysRes.error) {
    throw new Error(`Error fetching days from Supabase: ${daysRes.error.message}`);
  }
  if (machinesRes.error) {
    throw new Error(`Error fetching machine accounts from Supabase: ${machinesRes.error.message}`);
  }
  if (openingsRes.error) {
    throw new Error(`Error fetching day machine openings from Supabase: ${openingsRes.error.message}`);
  }
  if (txRes.error) {
    throw new Error(`Error fetching transactions from Supabase: ${txRes.error.message}`);
  }

  // Map machine openings by day_id -> { machine_account_id: opening_balance_cents }
  const openingsByDay: Record<string, Record<string, number>> = {};
  const rawOpenings = (openingsRes.data || []) as DayMachineOpeningRow[];
  for (const row of rawOpenings) {
    if (!openingsByDay[row.day_id]) {
      openingsByDay[row.day_id] = {};
    }
    openingsByDay[row.day_id][row.machine_account_id] = Number(row.opening_balance_cents) || 0;
  }

  // Map days
  const rawDays = (daysRes.data || []) as DayRow[];
  const days: Day[] = rawDays.map((row) => ({
    id: row.id,
    date: row.business_date,
    status: (row.status as DayStatus) || 'OPEN',
    openingBusinessBalanceCents: Number(row.opening_business_balance_cents) || 0,
    actualClosingBalanceCents:
      row.actual_closing_balance_cents !== null && row.actual_closing_balance_cents !== undefined
        ? Number(row.actual_closing_balance_cents)
        : null,
    machineOpeningBalances: openingsByDay[row.id] || {},
    createdAt: row.created_at,
    closedAt: row.closed_at ?? null,
    notes: row.notes || undefined,
  }));

  // Map machine accounts
  const rawMachines = (machinesRes.data || []) as MachineAccountRow[];
  const machines: MachineAccount[] = rawMachines.map((row) => ({
    id: row.id,
    name: row.name,
    initialBalanceCents: Number(row.initial_balance_cents) || 0,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  // Map transactions
  const rawTransactions = (txRes.data || []) as TransactionRow[];
  const transactions: Transaction[] = rawTransactions.map((row) => {
    const rawKind = row.transaction_kind || row.kind || 'INCOME';
    const kind: TransactionKind =
      rawKind === 'EXPENSE' ? 'EXPENSE' : rawKind === 'TRANSFER' ? 'TRANSFER' : 'INCOME';

    const sourceId = row.source_machine_account_id || row.source_machine_id || undefined;
    const destId = row.destination_machine_account_id || row.destination_machine_id || undefined;

    return {
      id: row.id,
      dayId: row.day_id,
      transactionKind: kind,
      category: row.category || '',
      amountCents: Number(row.amount_cents) || 0,
      description: row.description || '',
      sourceMachineAccountId: kind !== 'INCOME' ? sourceId : undefined,
      destinationMachineAccountId: kind !== 'EXPENSE' ? destId : undefined,
      timestamp: row.timestamp || row.created_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
    };
  });

  // Determine active day:
  // Preference: OPEN day if exists, otherwise latest day, otherwise null
  const openDay = days.find((d) => d.status === 'OPEN');
  const activeDayId = openDay ? openDay.id : days.length > 0 ? days[days.length - 1].id : null;

  return {
    days,
    machines,
    transactions,
    activeDayId,
  };
}
