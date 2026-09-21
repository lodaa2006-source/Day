/**
 * Cash Management State & Context - Phase 3
 *
 * Implements the complete Daily Operating Cycle:
 * START DAY -> RECORD TRANSACTIONS -> REVIEW DAY -> RECONCILE -> CLOSE DAY -> START NEXT DAY
 *
 * Strict Financial Integrity Rules:
 * 1. Each day is an independent financial journal with explicit OPEN / CLOSED status.
 * 2. Next Day opening business balance = Previous Day ACTUAL counted balance.
 * 3. Machine closing balances carry forward as next day's machine opening balances without money duplication.
 * 4. Transactions strictly belong to a specific day (`dayId`).
 * 5. Closed days are protected from normal modifications.
 * 6. Historical day viewer allows auditing past records.
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import {
  Transaction,
  MachineAccount,
  DailySummary,
  Reconciliation,
  NavTab,
  Day,
} from '../types';
import {
  calculateDailySummary,
  calculateMachineBalance,
  calculateMachineClosingBalance,
  calculateReconciliation,
  validateTransaction,
  validateStartNextDay,
  validateMachineAllocation,
  canDeleteTransaction,
  TransactionInput,
} from '../utils/calculations';
import { safeAdd, safeSubtract, formatEGP } from '../utils/money';

interface CashContextType {
  // Navigation & Tabs
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;

  // Day Lifecycle State
  days: Day[];
  activeDay: Day | null;
  currentDay: Day | null;
  viewingDayId: string | null;
  setViewingDayId: (id: string | null) => void;
  isCurrentDayClosed: boolean;
  isViewingHistoricalDay: boolean;

  // Day Lifecycle Actions
  startNextDay: (openingCents?: number) => Day;
  closeDay: (actualCountedCents: number, notes?: string) => void;
  reopenDay: (dayId: string) => void;

  // Modals
  isAddTransactionOpen: boolean;
  setIsAddTransactionOpen: (open: boolean) => void;
  isAddMachineOpen: boolean;
  setIsAddMachineOpen: (open: boolean) => void;
  isEditOpeningBalanceOpen: boolean;
  setIsEditOpeningBalanceOpen: (open: boolean) => void;
  isCloseDayModalOpen: boolean;
  setIsCloseDayModalOpen: (open: boolean) => void;
  isStartDayModalOpen: boolean;
  setIsStartDayModalOpen: (open: boolean) => void;

  // Editing & Deleting Modals State
  editingTransaction: Transaction | null;
  setEditingTransaction: (tx: Transaction | null) => void;
  deletingTransaction: Transaction | null;
  setDeletingTransaction: (tx: Transaction | null) => void;

  // Financial State for Currently Active/Viewed Day
  openingBalanceCents: number;
  setOpeningBalance: (cents: number) => void;
  transactions: Transaction[]; // Transactions for current viewed day
  allTransactions: Transaction[]; // All transactions across all days
  machines: MachineAccount[];
  actualCountedCents: number | null;
  setActualCounted: (cents: number | null) => void;

  // CRUD Operations
  addTransaction: (tx: TransactionInput) => Transaction;
  updateTransaction: (id: string, tx: TransactionInput) => Transaction;
  deleteTransaction: (id: string) => void;
  addMachine: (name: string, initialBalanceCents?: number) => MachineAccount;
  updateMachineInitialBalance: (id: string, initialBalanceCents: number) => void;
  deleteMachine: (id: string) => void;
  clearAllData: () => void;

  // Derived Financial Computations for Current Day
  dailySummary: DailySummary;
  machineBalances: Record<string, number>;
  reconciliation: Reconciliation;
}

const STORAGE_KEYS = {
  DAYS: 'cash_journal_days_v3',
  ACTIVE_DAY_ID: 'cash_journal_active_day_id_v3',
  TRANSACTIONS: 'cash_journal_transactions_v3',
  LEGACY_TRANSACTIONS: 'cash_journal_transactions_v2',
  MACHINES: 'cash_journal_machines_v3',
  LEGACY_MACHINES: 'cash_journal_machines_v2',
  OPENING_BALANCE: 'cash_journal_opening_balance_v3',
  LEGACY_OPENING_BALANCE: 'cash_journal_opening_balance_v2',
  ACTUAL_COUNTED: 'cash_journal_actual_counted_v3',
};

const APPLICATION_KEY_PREFIX = 'cash_journal_';
const RESET_ZERO_STATE_FLAG = 'cash_journal_clean_slate_zero_state_v2';

export function executeFinancialStorageReset(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (localStorage.getItem(RESET_ZERO_STATE_FLAG) !== 'done') {
      const keysToDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(APPLICATION_KEY_PREFIX) && k !== RESET_ZERO_STATE_FLAG) {
          keysToDelete.push(k);
        }
      }
      for (const k of keysToDelete) {
        localStorage.removeItem(k);
      }
      localStorage.setItem(RESET_ZERO_STATE_FLAG, 'done');
    }
  } catch (e) {
    console.warn('Could not run financial localStorage reset', e);
  }
}

// Normalizes any legacy transactions by assigning dayId
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeTransaction(raw: any, fallbackDayId: string): Transaction {
  let kind = raw.transactionKind;
  if (!kind) {
    if (raw.type === 'expense') kind = 'EXPENSE';
    else if (raw.type === 'transfer') kind = 'TRANSFER';
    else kind = 'INCOME';
  }

  let sourceId = raw.sourceMachineAccountId;
  let destId = raw.destinationMachineAccountId;

  if (!sourceId && !destId && raw.machineAccountId) {
    if (kind === 'INCOME') {
      destId = raw.machineAccountId;
    } else if (kind === 'EXPENSE') {
      sourceId = raw.machineAccountId;
    }
  }

  const category = raw.category || (kind === 'INCOME' ? 'دخل آخر' : kind === 'EXPENSE' ? 'مصروف آخر' : 'تحويل بين الماكينات');

  return {
    id: raw.id || `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    dayId: raw.dayId || fallbackDayId,
    transactionKind: kind,
    category,
    amountCents: Math.max(0, Math.round(Number(raw.amountCents) || 0)),
    description: raw.description || '',
    sourceMachineAccountId: kind !== 'INCOME' ? sourceId : undefined,
    destinationMachineAccountId: kind !== 'EXPENSE' ? destId : undefined,
    timestamp: raw.timestamp || new Date().toISOString(),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

const CashContext = createContext<CashContextType | undefined>(undefined);

export const CashProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
  const [isAddMachineOpen, setIsAddMachineOpen] = useState(false);
  const [isEditOpeningBalanceOpen, setIsEditOpeningBalanceOpen] = useState(false);
  const [isCloseDayModalOpen, setIsCloseDayModalOpen] = useState(false);
  const [isStartDayModalOpen, setIsStartDayModalOpen] = useState(false);

  // Modals for editing and deleting transactions
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null);

  // Historical Viewing State
  const [viewingDayId, setViewingDayId] = useState<string | null>(null);

  // Complete one-time clean slate reset of local financial keys
  executeFinancialStorageReset();

  // 1. Load Days
  const [days, setDays] = useState<Day[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.DAYS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Error reading days from localStorage', e);
    }
    return [];
  });

  // 2. Active Day ID
  const [activeDayId, setActiveDayId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_DAY_ID);
      if (saved) return saved;
    } catch (e) {
      console.warn('Error reading activeDayId from localStorage', e);
    }
    return null;
  });

  // 3. Load Machines
  const [machines, setMachines] = useState<MachineAccount[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MACHINES) || localStorage.getItem(STORAGE_KEYS.LEGACY_MACHINES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Error reading machines from localStorage', e);
    }
    return [];
  });

  // 4. Load All Transactions
  const [allTransactions, setAllTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS) || localStorage.getItem(STORAGE_KEYS.LEGACY_TRANSACTIONS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((tx) => normalizeTransaction(tx, ''));
        }
      }
    } catch (e) {
      console.warn('Error reading transactions from localStorage', e);
    }
    return [];
  });

  // Determine current active Day and currently viewed Day
  const activeDay = useMemo(() => {
    return days.find((d) => d.id === activeDayId) || days[days.length - 1] || null;
  }, [days, activeDayId]);

  const currentDay = useMemo(() => {
    if (viewingDayId) {
      const found = days.find((d) => d.id === viewingDayId);
      if (found) return found;
    }
    return activeDay;
  }, [days, viewingDayId, activeDay]);

  const isCurrentDayClosed = currentDay?.status === 'CLOSED';
  const isViewingHistoricalDay = viewingDayId !== null && viewingDayId !== activeDay?.id;

  // Transactions filtered for the currently viewed day
  const transactions = useMemo(() => {
    if (!currentDay) return [];
    return allTransactions.filter((tx) => tx.dayId === currentDay.id);
  }, [allTransactions, currentDay]);

  // Current opening business balance
  const openingBalanceCents = currentDay?.openingBusinessBalanceCents || 0;

  // Actual counted balance for current day
  const actualCountedCents = currentDay?.actualClosingBalanceCents ?? null;

  // Derived calculations for current viewed day
  const dailySummary = useMemo(() => {
    if (!currentDay) {
      const machineInitialTotal = machines.reduce((acc, m) => safeAdd(acc, m.initialBalanceCents), 0);
      return calculateDailySummary(machineInitialTotal, [], undefined, undefined, 'OPEN', machineInitialTotal);
    }
    const allocatedOpening = currentDay.machineOpeningBalances
      ? Object.values(currentDay.machineOpeningBalances).reduce((acc, val) => safeAdd(acc, val), 0)
      : machines.reduce((acc, m) => safeAdd(acc, m.initialBalanceCents), 0);

    return calculateDailySummary(
      currentDay.openingBusinessBalanceCents,
      transactions,
      currentDay.date,
      currentDay.id,
      currentDay.status,
      allocatedOpening
    );
  }, [currentDay, transactions, machines]);

  const machineBalances = useMemo(() => {
    const balances: Record<string, number> = {};
    for (const machine of machines) {
      const dayOpening = currentDay?.machineOpeningBalances?.[machine.id] ?? machine.initialBalanceCents;
      balances[machine.id] = calculateMachineBalance(machine, transactions, dayOpening);
    }
    return balances;
  }, [machines, transactions, currentDay]);

  const reconciliation = useMemo(() => {
    return calculateReconciliation(dailySummary.expectedBalanceCents, actualCountedCents);
  }, [dailySummary.expectedBalanceCents, actualCountedCents]);

  // Persistent storage sync
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.DAYS, JSON.stringify(days));
    } catch (e) {
      console.warn('Failed saving days', e);
    }
  }, [days]);

  useEffect(() => {
    try {
      if (activeDayId) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_DAY_ID, activeDayId);
      }
    } catch (e) {
      console.warn('Failed saving activeDayId', e);
    }
  }, [activeDayId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.MACHINES, JSON.stringify(machines));
    } catch (e) {
      console.warn('Failed saving machines', e);
    }
  }, [machines]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(allTransactions));
    } catch (e) {
      console.warn('Failed saving transactions', e);
    }
  }, [allTransactions]);

  // Actions
  const setOpeningBalance = useCallback(
    (cents: number) => {
      const safeAmount = Math.max(0, Math.round(cents));
      if (!currentDay) return;
      if (currentDay.status === 'CLOSED') {
        throw new Error('لا يمكن تعديل رصيد البداية ليوم مغلق.');
      }

      // Financial rule:
      // Opening Business Balance must never be less than already allocated machine money!
      const totalAllocated = Object.values(currentDay.machineOpeningBalances || {}).reduce(
        (acc, val) => safeAdd(acc, val),
        0
      );
      if (safeAmount < totalAllocated) {
        throw new Error(
          `لا يمكن أن يكون رصيد بداية اليوم أقل من إجمالي المبالغ الموزعة على الماكينات (${formatEGP(totalAllocated)}).`
        );
      }

      // Machine allocations are preserved. The unallocated portion is derived as:
      // safeSubtract(safeAmount, totalAllocated)
      setDays((prev) =>
        prev.map((d) =>
          d.id === currentDay.id
            ? {
                ...d,
                openingBusinessBalanceCents: safeAmount,
              }
            : d
        )
      );
    },
    [currentDay]
  );

  const setActualCounted = useCallback(
    (cents: number | null) => {
      const safeAmount = cents !== null ? Math.max(0, Math.round(cents)) : null;
      if (!currentDay) return;
      if (currentDay.status === 'CLOSED') {
        throw new Error('لا يمكن تعديل المبلغ الفعلي ليوم مغلق. يجب إعادة فتح اليوم أولاً.');
      }
      setDays((prev) =>
        prev.map((d) => (d.id === currentDay.id ? { ...d, actualClosingBalanceCents: safeAmount } : d))
      );
    },
    [currentDay]
  );

  // Day Lifecycle: Close Day
  const closeDay = useCallback(
    (countedCents: number, notes?: string) => {
      if (!activeDay) {
        throw new Error('لا يوجد يوم نشط للإغلاق.');
      }
      if (activeDay.status === 'CLOSED') {
        throw new Error('اليوم مغلق بالفعل.');
      }

      const safeCounted = Math.max(0, Math.round(countedCents));
      const now = new Date().toISOString();

      setDays((prev) => {
        const closedIndex = prev.findIndex((d) => d.id === activeDay.id);
        const nextDay = closedIndex !== -1 && closedIndex + 1 < prev.length ? prev[closedIndex + 1] : null;

        let nextDayUpdates: Partial<Day> | null = null;
        if (nextDay) {
          const dayTxs = allTransactions.filter((tx) => tx.dayId === activeDay.id);
          const nextMachineOpenings: Record<string, number> = {};
          for (const m of machines) {
            const prevInit = activeDay.machineOpeningBalances?.[m.id] ?? m.initialBalanceCents;
            nextMachineOpenings[m.id] = calculateMachineClosingBalance(m.id, prevInit, dayTxs);
          }
          nextDayUpdates = {
            openingBusinessBalanceCents: safeCounted,
            machineOpeningBalances: nextMachineOpenings,
          };
        }

        return prev.map((d, idx) => {
          if (d.id === activeDay.id) {
            return {
              ...d,
              status: 'CLOSED',
              actualClosingBalanceCents: safeCounted,
              closedAt: now,
              notes: notes ? notes.trim() : d.notes,
            };
          }
          if (nextDayUpdates && idx === closedIndex + 1) {
            return {
              ...d,
              ...nextDayUpdates,
            };
          }
          return d;
        });
      });
    },
    [activeDay, allTransactions, machines]
  );

  // Day Lifecycle: Start Next Day
  const startNextDay = useCallback(
    (customOpeningCents?: number): Day => {
      // Must look at the latest day in chronological sequence
      const lastDay = days[days.length - 1] || activeDay || null;
      if (!lastDay) {
        const totalMachineInitial = machines.reduce((acc, m) => safeAdd(acc, m.initialBalanceCents), 0);
        const nextOpeningBusinessBalance =
          customOpeningCents !== undefined ? Math.max(0, Math.round(customOpeningCents)) : totalMachineInitial;
        if (nextOpeningBusinessBalance < totalMachineInitial) {
          throw new Error(
            `لا يمكن أن يكون رصيد بداية اليوم أقل من إجمالي رصيد الماكينات (${formatEGP(totalMachineInitial)}).`
          );
        }
        const todayStr = new Date().toISOString().split('T')[0];
        const newDayId = `day-${todayStr}-${Date.now().toString(36).substring(2, 6)}`;
        const now = new Date().toISOString();
        const nextMachineOpeningBalances: Record<string, number> = {};
        for (const m of machines) {
          nextMachineOpeningBalances[m.id] = m.initialBalanceCents;
        }
        const newDay: Day = {
          id: newDayId,
          date: todayStr,
          status: 'OPEN',
          openingBusinessBalanceCents: nextOpeningBusinessBalance,
          actualClosingBalanceCents: null,
          machineOpeningBalances: nextMachineOpeningBalances,
          createdAt: now,
          closedAt: null,
        };

        setDays([newDay]);
        setActiveDayId(newDay.id);
        setViewingDayId(newDay.id);

        return newDay;
      }

      // Validate transitions
      const dayTxs = allTransactions.filter((tx) => tx.dayId === lastDay.id);
      const validation = validateStartNextDay(lastDay, dayTxs);
      if (!validation.valid) {
        throw new Error(validation.error || 'لا يمكن بدء يوم جديد');
      }

      // Next opening balance MUST default to previous day's actual counted balance!
      let nextOpeningBusinessBalance = customOpeningCents !== undefined ? Math.max(0, Math.round(customOpeningCents)) : 0;
      if (lastDay.actualClosingBalanceCents !== null && customOpeningCents === undefined) {
        nextOpeningBusinessBalance = lastDay.actualClosingBalanceCents;
      }

      // Carry forward machine closing balances
      const nextMachineOpeningBalances: Record<string, number> = {};
      for (const m of machines) {
        const prevInitial = lastDay.machineOpeningBalances?.[m.id] ?? m.initialBalanceCents;
        const closingBal = calculateMachineClosingBalance(m.id, prevInitial, dayTxs);
        nextMachineOpeningBalances[m.id] = closingBal;
      }

      // Verify next opening business balance is not less than the carried forward machine balances
      const totalMachinesCalculated = Object.values(nextMachineOpeningBalances).reduce(
        (acc, b) => safeAdd(acc, b),
        0
      );
      if (nextOpeningBusinessBalance < totalMachinesCalculated) {
        throw new Error(
          `لا يمكن أن يكون رصيد بداية اليوم أقل من إجمالي أرصدة الماكينات المرحلة (${formatEGP(totalMachinesCalculated)}).`
        );
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const newDayId = `day-${todayStr}-${Date.now().toString(36).substring(2, 6)}`;
      const now = new Date().toISOString();

      const newDay: Day = {
        id: newDayId,
        date: todayStr,
        status: 'OPEN',
        openingBusinessBalanceCents: nextOpeningBusinessBalance,
        actualClosingBalanceCents: null,
        machineOpeningBalances: nextMachineOpeningBalances,
        createdAt: now,
        closedAt: null,
      };

      setDays((prev) => [...prev, newDay]);
      setActiveDayId(newDay.id);
      setViewingDayId(newDay.id);

      return newDay;
    },
    [activeDay, days, allTransactions, machines]
  );

  // Explicit Reopen Day Workflow (with strict chronological integrity)
  const reopenDay = useCallback(
    (dayId: string) => {
      const targetDay = days.find((d) => d.id === dayId);
      if (!targetDay) throw new Error('اليوم المطلوب غير موجود');

      setDays((prev) =>
        prev.map((d) => {
          if (d.id !== dayId) return d;
          return {
            ...d,
            status: 'OPEN',
            closedAt: null,
          };
        })
      );
      setActiveDayId(dayId);
      setViewingDayId(dayId);
    },
    [days]
  );

  // Transaction CRUD strictly bound to active day
  const addTransaction = useCallback(
    (input: TransactionInput): Transaction => {
      if (!activeDay) {
        throw new Error('لا يوجد يوم نشط حالياً. برجاء بدء يوم جديد أولاً.');
      }
      if (activeDay.status === 'CLOSED') {
        throw new Error('اليوم الحالي مغلق. لا يمكن تسجيل حركات جديدة.');
      }

      const machineNamesMap = Object.fromEntries(machines.map((m) => [m.id, m.name]));
      const validation = validateTransaction(input, {
        machineBalances,
        machineNames: machineNamesMap,
        allowUnassignedAccounts: false,
      });

      if (!validation.valid) {
        throw new Error(validation.error || 'بيانات الحركة غير صالحة');
      }

      const now = new Date().toISOString();
      const newTx: Transaction = {
        id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        dayId: activeDay.id,
        transactionKind: input.transactionKind,
        category: input.category.trim(),
        amountCents: input.amountCents,
        description: input.description ? input.description.trim() : '',
        sourceMachineAccountId: input.transactionKind !== 'INCOME' ? input.sourceMachineAccountId : undefined,
        destinationMachineAccountId: input.transactionKind !== 'EXPENSE' ? input.destinationMachineAccountId : undefined,
        timestamp: input.timestamp || now,
        createdAt: now,
        updatedAt: now,
      };

      setAllTransactions((prev) => [newTx, ...prev]);
      return newTx;
    },
    [activeDay, machineBalances, machines]
  );

  const updateTransaction = useCallback(
    (id: string, input: TransactionInput): Transaction => {
      const existing = allTransactions.find((t) => t.id === id);
      if (!existing) {
        throw new Error('الحركة المطلوب تعديلها غير موجودة.');
      }

      const targetDay = days.find((d) => d.id === existing.dayId);
      if (targetDay && targetDay.status === 'CLOSED') {
        throw new Error('لا يمكن تعديل حركة تابعة ليوم مغلق.');
      }

      const machineNamesMap = Object.fromEntries(machines.map((m) => [m.id, m.name]));
      const validation = validateTransaction(input, {
        machineBalances,
        machineNames: machineNamesMap,
        existingTx: existing,
        allowUnassignedAccounts: false,
      });

      if (!validation.valid) {
        throw new Error(validation.error || 'بيانات الحركة غير صالحة');
      }

      const now = new Date().toISOString();
      let updatedTx: Transaction | null = null;

      setAllTransactions((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          updatedTx = {
            ...item,
            transactionKind: input.transactionKind,
            category: input.category.trim(),
            amountCents: input.amountCents,
            description: input.description ? input.description.trim() : '',
            sourceMachineAccountId: input.transactionKind !== 'INCOME' ? input.sourceMachineAccountId : undefined,
            destinationMachineAccountId: input.transactionKind !== 'EXPENSE' ? input.destinationMachineAccountId : undefined,
            timestamp: input.timestamp || item.timestamp,
            updatedAt: now,
          };
          return updatedTx;
        })
      );

      return updatedTx!;
    },
    [allTransactions, days, machineBalances, machines]
  );

  const deleteTransaction = useCallback(
    (id: string) => {
      const existing = allTransactions.find((t) => t.id === id);
      if (!existing) return;

      const targetDay = days.find((d) => d.id === existing.dayId);
      if (targetDay && targetDay.status === 'CLOSED') {
        throw new Error('لا يمكن حذف حركة تابعة ليوم مغلق.');
      }

      const machineNamesMap = Object.fromEntries(machines.map((m) => [m.id, m.name]));
      const check = canDeleteTransaction(existing, machineBalances, machineNamesMap);
      if (!check.allowed) {
        throw new Error(check.error || 'لا يمكن حذف الحركة لأنها ستتسبب في رصيد سالب للماكينة');
      }

      setAllTransactions((prev) => prev.filter((tx) => tx.id !== id));
    },
    [allTransactions, days, machineBalances, machines]
  );

  const addMachine = useCallback(
    (name: string, initialBalanceCents: number = 0): MachineAccount => {
      const safeAmount = Math.max(0, Math.round(initialBalanceCents));

      if (currentDay && currentDay.status === 'OPEN' && currentDay.openingBusinessBalanceCents > 0) {
        const currentAllocated = Object.values(currentDay.machineOpeningBalances || {}).reduce(
          (acc, val) => safeAdd(acc, val),
          0
        );
        const validation = validateMachineAllocation(
          safeAmount,
          currentAllocated,
          currentDay.openingBusinessBalanceCents
        );
        if (!validation.valid) {
          throw new Error(validation.error || 'المبلغ المطلوب توزيعه أكبر من المبلغ المتبقي من افتتاح اليوم.');
        }
      }

      const now = new Date().toISOString();
      const newMachine: MachineAccount = {
        id: `m-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: name.trim(),
        initialBalanceCents: safeAmount,
        createdAt: now,
        updatedAt: now,
        isActive: true,
      };

      setMachines((prev) => [...prev, newMachine]);

      // Machine allocation distributes existing opening business money
      // If opening balance was 0, it sets it to the sum of machines
      if (currentDay && currentDay.status === 'OPEN') {
        setDays((prev) =>
          prev.map((d) => {
            if (d.id !== currentDay.id) return d;
            const updatedOpenings = {
              ...d.machineOpeningBalances,
              [newMachine.id]: safeAmount,
            };
            const sumAllocated = Object.values(updatedOpenings).reduce((a, b) => safeAdd(a, b), 0);
            const newOpening = d.openingBusinessBalanceCents > 0 ? d.openingBusinessBalanceCents : sumAllocated;
            return {
              ...d,
              openingBusinessBalanceCents: newOpening,
              machineOpeningBalances: updatedOpenings,
            };
          })
        );
      }

      return newMachine;
    },
    [currentDay]
  );

  const updateMachineInitialBalance = useCallback(
    (id: string, initialBalanceCents: number) => {
      const safeAmount = Math.max(0, Math.round(initialBalanceCents));

      if (currentDay && currentDay.status === 'OPEN' && currentDay.openingBusinessBalanceCents > 0) {
        const otherAllocated = Object.entries(currentDay.machineOpeningBalances || {}).reduce(
          (acc, [mId, val]) => (mId === id ? acc : safeAdd(acc, val)),
          0
        );
        const validation = validateMachineAllocation(
          safeAmount,
          otherAllocated,
          currentDay.openingBusinessBalanceCents
        );
        if (!validation.valid) {
          throw new Error(validation.error || 'المبلغ المطلوب توزيعه أكبر من المبلغ المتبقي من افتتاح اليوم.');
        }
      }

      const now = new Date().toISOString();
      setMachines((prev) =>
        prev.map((m) => (m.id === id ? { ...m, initialBalanceCents: safeAmount, updatedAt: now } : m))
      );

      // If active day is open, update machine opening without changing overall opening balance
      if (currentDay && currentDay.status === 'OPEN') {
        setDays((prev) =>
          prev.map((d) => {
            if (d.id !== currentDay.id) return d;
            const updatedMachineOpenings = {
              ...d.machineOpeningBalances,
              [id]: safeAmount,
            };
            const sumAllocated = Object.values(updatedMachineOpenings).reduce((acc, v) => safeAdd(acc, v), 0);
            const newOpening = d.openingBusinessBalanceCents > 0 ? d.openingBusinessBalanceCents : sumAllocated;
            return {
              ...d,
              openingBusinessBalanceCents: newOpening,
              machineOpeningBalances: updatedMachineOpenings,
            };
          })
        );
      }
    },
    [currentDay]
  );

  const deleteMachine = useCallback(
    (id: string) => {
      const hasTxs = allTransactions.some(
        (tx) => tx.sourceMachineAccountId === id || tx.destinationMachineAccountId === id
      );
      const balance = machineBalances[id] ?? 0;
      if (hasTxs || balance !== 0) {
        throw new Error('لا يمكن حذف الماكينة / الحساب لوجود حركات مسجلة أو رصيد غير صفري مرتبط بها.');
      }
      setMachines((prev) => prev.filter((m) => m.id !== id));
    },
    [allTransactions, machineBalances]
  );

  const clearAllData = useCallback(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const keysToDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(APPLICATION_KEY_PREFIX)) {
          keysToDelete.push(k);
        }
      }
      for (const k of keysToDelete) {
        localStorage.removeItem(k);
      }
    }
    setAllTransactions([]);
    setDays([]);
    setActiveDayId(null);
    setViewingDayId(null);
    setMachines([]);
  }, []);

  return (
    <CashContext.Provider
      value={{
        activeTab,
        setActiveTab,
        days,
        activeDay,
        currentDay,
        viewingDayId,
        setViewingDayId,
        isCurrentDayClosed,
        isViewingHistoricalDay,
        startNextDay,
        closeDay,
        reopenDay,
        isAddTransactionOpen,
        setIsAddTransactionOpen,
        isAddMachineOpen,
        setIsAddMachineOpen,
        isEditOpeningBalanceOpen,
        setIsEditOpeningBalanceOpen,
        isCloseDayModalOpen,
        setIsCloseDayModalOpen,
        isStartDayModalOpen,
        setIsStartDayModalOpen,
        editingTransaction,
        setEditingTransaction,
        deletingTransaction,
        setDeletingTransaction,
        openingBalanceCents,
        setOpeningBalance,
        transactions,
        allTransactions,
        machines,
        actualCountedCents,
        setActualCounted,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        addMachine,
        updateMachineInitialBalance,
        deleteMachine,
        clearAllData,
        dailySummary,
        machineBalances,
        reconciliation,
      }}
    >
      {children}
    </CashContext.Provider>
  );
};

export const useCash = (): CashContextType => {
  const context = useContext(CashContext);
  if (!context) {
    throw new Error('useCash must be used within a CashProvider');
  }
  return context;
};
