/**
 * Financial Calculation & Validation Logic
 *
 * Implements core daily cash journal accounting formulas for Phase 2:
 * 1. REAL INCOME increases business total.
 * 2. REAL EXPENSE decreases business total.
 * 3. INTERNAL TRANSFER moves money between machines/accounts only and has ZERO effect on business total.
 *
 * All balances are strictly derived from the transaction ledger and opening balances.
 */

import { Transaction, MachineAccount, DailySummary, Reconciliation, TransactionKind, Day } from '../types';
import { safeAdd, safeSubtract, formatCurrency } from './money';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface TransactionValidationContext {
  machineBalances?: Record<string, number>;
  machineNames?: Record<string, string>;
  existingTx?: Transaction; // For updating existing transaction
  allowUnassignedAccounts?: boolean; // If false (default), destination for income and source for expense are required
}

export interface TransactionInput {
  dayId?: string;
  transactionKind: TransactionKind;
  category: string;
  amountCents: number;
  description?: string;
  sourceMachineAccountId?: string;
  destinationMachineAccountId?: string;
  timestamp?: string;
}

/**
 * Strict validation rules for financial transactions before entering application state:
 *
 * For INCOME:
 * - amount must be an integer greater than zero
 * - source machine/account MUST NOT be used
 * - destination machine/account is REQUIRED (or drawer)
 *
 * For EXPENSE:
 * - amount must be an integer greater than zero
 * - destination machine/account MUST NOT be used
 * - source machine/account is REQUIRED
 * - source machine must have sufficient funds (no negative balance)
 *
 * For TRANSFER:
 * - amount must be an integer greater than zero
 * - source machine/account is REQUIRED
 * - destination machine/account is REQUIRED
 * - source and destination CANNOT be the same
 * - source machine must have sufficient funds (no negative balance)
 * - transfer must not affect total business money
 */
export function validateTransaction(
  input: TransactionInput,
  context?: TransactionValidationContext
): ValidationResult {
  // 1. Amount validation
  if (typeof input.amountCents !== 'number' || !Number.isFinite(input.amountCents) || isNaN(input.amountCents)) {
    return { valid: false, error: 'المبلغ غير صالح' };
  }

  if (input.amountCents <= 0) {
    return { valid: false, error: 'يجب أن يكون المبلغ أكبر من صفر' };
  }

  if (!Number.isInteger(input.amountCents)) {
    return { valid: false, error: 'لا يمكن أن يحتوي المبلغ على كسور غير صحيحة' };
  }

  if (input.amountCents > 10_000_000_000) {
    return { valid: false, error: 'المبلغ كبير جداً ويتجاوز الحد الأقصى المسموح به' };
  }

  const allowUnassigned = context?.allowUnassignedAccounts === true;

  // 2. Kind validation & account existence check
  if (input.transactionKind === 'INCOME') {
    if (input.sourceMachineAccountId && input.sourceMachineAccountId.trim()) {
      return { valid: false, error: 'لا يمكن تحديد ماكينة مصدر لحركة إيراد/دخل' };
    }
    if (!allowUnassigned && (!input.destinationMachineAccountId || !input.destinationMachineAccountId.trim())) {
      return { valid: false, error: 'يجب تحديد الماكينة أو الحساب المستلم للإيراد' };
    }
    if (context?.machineBalances && input.destinationMachineAccountId) {
      if (!(input.destinationMachineAccountId in context.machineBalances)) {
        return { valid: false, error: 'الماكينة أو الحساب المستلم المحدد غير موجود بالنظام' };
      }
    }
  } else if (input.transactionKind === 'EXPENSE') {
    if (input.destinationMachineAccountId && input.destinationMachineAccountId.trim()) {
      return { valid: false, error: 'لا يمكن تحديد ماكينة مستلمة لحركة مصروف/خرج' };
    }
    if (!allowUnassigned && (!input.sourceMachineAccountId || !input.sourceMachineAccountId.trim())) {
      return { valid: false, error: 'يجب تحديد الماكينة أو الحساب المصدر للمصروف' };
    }
    if (context?.machineBalances && input.sourceMachineAccountId) {
      if (!(input.sourceMachineAccountId in context.machineBalances)) {
        return { valid: false, error: 'الماكينة أو الحساب المصدر المحدد غير موجود بالنظام' };
      }
    }
  } else if (input.transactionKind === 'TRANSFER') {
    if (!input.sourceMachineAccountId || !input.sourceMachineAccountId.trim()) {
      return { valid: false, error: 'يجب تحديد الماكينة أو الحساب المحول منه' };
    }
    if (!input.destinationMachineAccountId || !input.destinationMachineAccountId.trim()) {
      return { valid: false, error: 'يجب تحديد الماكينة أو الحساب المحول إليه' };
    }
    if (input.sourceMachineAccountId.trim() === input.destinationMachineAccountId.trim()) {
      return { valid: false, error: 'لا يمكن التحويل من وإلى نفس الماكينة / الحساب' };
    }
    if (context?.machineBalances) {
      if (!(input.sourceMachineAccountId in context.machineBalances)) {
        return { valid: false, error: 'الماكينة المحول منها غير موجودة بالنظام' };
      }
      if (!(input.destinationMachineAccountId in context.machineBalances)) {
        return { valid: false, error: 'الماكينة المحول إليها غير موجودة بالنظام' };
      }
    }
  } else {
    return { valid: false, error: 'نوع الحركة غير معرّف' };
  }

  // 3. Universal overdraft & negative balance simulation
  if (context?.machineBalances) {
    const simulated: Record<string, number> = { ...context.machineBalances };

    // A. Revert existing transaction if updating
    if (context.existingTx) {
      const ex = context.existingTx;
      if (ex.transactionKind === 'INCOME' && ex.destinationMachineAccountId) {
        simulated[ex.destinationMachineAccountId] = safeSubtract(
          simulated[ex.destinationMachineAccountId] ?? 0,
          ex.amountCents
        );
      } else if (ex.transactionKind === 'EXPENSE' && ex.sourceMachineAccountId) {
        simulated[ex.sourceMachineAccountId] = safeAdd(
          simulated[ex.sourceMachineAccountId] ?? 0,
          ex.amountCents
        );
      } else if (ex.transactionKind === 'TRANSFER') {
        if (ex.sourceMachineAccountId) {
          simulated[ex.sourceMachineAccountId] = safeAdd(
            simulated[ex.sourceMachineAccountId] ?? 0,
            ex.amountCents
          );
        }
        if (ex.destinationMachineAccountId) {
          simulated[ex.destinationMachineAccountId] = safeSubtract(
            simulated[ex.destinationMachineAccountId] ?? 0,
            ex.amountCents
          );
        }
      }
    }

    // B. Apply new transaction
    if (input.transactionKind === 'INCOME' && input.destinationMachineAccountId) {
      simulated[input.destinationMachineAccountId] = safeAdd(
        simulated[input.destinationMachineAccountId] ?? 0,
        input.amountCents
      );
    } else if (input.transactionKind === 'EXPENSE' && input.sourceMachineAccountId) {
      simulated[input.sourceMachineAccountId] = safeSubtract(
        simulated[input.sourceMachineAccountId] ?? 0,
        input.amountCents
      );
    } else if (input.transactionKind === 'TRANSFER') {
      if (input.sourceMachineAccountId) {
        simulated[input.sourceMachineAccountId] = safeSubtract(
          simulated[input.sourceMachineAccountId] ?? 0,
          input.amountCents
        );
      }
      if (input.destinationMachineAccountId) {
        simulated[input.destinationMachineAccountId] = safeAdd(
          simulated[input.destinationMachineAccountId] ?? 0,
          input.amountCents
        );
      }
    }

    // C. Verify all resulting machine balances are non-negative
    for (const [mId, bal] of Object.entries(simulated)) {
      if (bal < 0) {
        const name = context.machineNames?.[mId] || 'الماكينة / الحساب المحدد';
        return {
          valid: false,
          error: `العملية غير مقبولة لأن رصيد ${name} سيصبح سالباً (${formatCurrency(bal)}). الرصيد لا يمكن أن يكون سالباً أبداً.`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Checks whether a transaction can be safely deleted without causing any machine balance to become negative.
 */
export function canDeleteTransaction(
  tx: Transaction,
  currentMachineBalances: Record<string, number>,
  machineNames?: Record<string, string>
): { allowed: boolean; error?: string } {
  if (tx.transactionKind === 'INCOME' && tx.destinationMachineAccountId) {
    const current = currentMachineBalances[tx.destinationMachineAccountId] ?? 0;
    if (current < tx.amountCents) {
      const name = machineNames?.[tx.destinationMachineAccountId] || 'الماكينة المستلمة';
      return {
        allowed: false,
        error: `لا يمكن حذف حركة الإيراد لأن الرصيد الحالي للماكينة المستلمة (${name} = ${formatCurrency(current)}) أقل من قيمة الحركة (${formatCurrency(tx.amountCents)})، وحذفها سيجعل رصيد الماكينة سالباً.`,
      };
    }
  }

  if (tx.transactionKind === 'TRANSFER' && tx.destinationMachineAccountId) {
    const current = currentMachineBalances[tx.destinationMachineAccountId] ?? 0;
    if (current < tx.amountCents) {
      const name = machineNames?.[tx.destinationMachineAccountId] || 'الماكينة المستلمة';
      return {
        allowed: false,
        error: `لا يمكن حذف التحويل لأن الرصيد الحالي للماكينة المستلمة (${name} = ${formatCurrency(current)}) أقل من قيمة التحويل (${formatCurrency(tx.amountCents)})، وحذفها سيجعل رصيدها سالباً.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Checks machine balances consistency with daily expected balance
 */
export function verifyMachinesConsistency(
  summary: DailySummary,
  machineBalances: Record<string, number>,
  unallocatedCents: number = summary.unallocatedOpeningCents ?? 0
): {
  isConsistent: boolean;
  totalMachinesCents: number;
  unallocatedCents: number;
  totalAccountedCents: number;
  expectedBalanceCents: number;
  differenceCents: number;
} {
  const totalMachinesCents = Object.values(machineBalances).reduce(
    (acc, bal) => safeAdd(acc, bal),
    0
  );
  const totalAccountedCents = safeAdd(totalMachinesCents, unallocatedCents);
  const differenceCents = safeSubtract(totalAccountedCents, summary.expectedBalanceCents);
  return {
    isConsistent: differenceCents === 0,
    totalMachinesCents,
    unallocatedCents,
    totalAccountedCents,
    expectedBalanceCents: summary.expectedBalanceCents,
    differenceCents,
  };
}

/**
 * Validates that adding or updating a machine initial balance does NOT exceed
 * the business opening balance.
 *
 * Financial rule:
 * Machine allocation is only a distribution of already-existing opening money.
 * The user must NEVER be able to allocate more money to machines than the opening business balance.
 */
export function validateMachineAllocation(
  requestedMachineCents: number,
  currentOtherAllocatedCents: number,
  openingBusinessBalanceCents: number
): { valid: boolean; error?: string } {
  if (requestedMachineCents < 0) {
    return { valid: false, error: 'لا يمكن أن يكون رصيد الماكينة سالباً' };
  }
  const totalAfter = safeAdd(currentOtherAllocatedCents, requestedMachineCents);
  if (openingBusinessBalanceCents > 0 && totalAfter > openingBusinessBalanceCents) {
    return {
      valid: false,
      error: 'المبلغ المطلوب توزيعه أكبر من المبلغ المتبقي من افتتاح اليوم.',
    };
  }
  return { valid: true };
}

/**
 * Calculates daily summary metrics from opening balance and transactions list.
 *
 * Financial rule:
 * Business Total = Opening Business Balance + REAL INCOME - REAL EXPENSE
 *
 * INTERNAL TRANSFERS MUST NOT AFFECT THIS TOTAL.
 * totalTransfers is tracked separately for transparency and auditability.
 */
export function calculateDailySummary(
  openingBalanceCents: number,
  transactions: Transaction[],
  date: string = new Date().toISOString().split('T')[0],
  dayId?: string,
  status?: 'OPEN' | 'CLOSED',
  allocatedOpeningCents: number = 0
): DailySummary {
  let totalIncomeCents = 0;
  let totalExpenseCents = 0;
  let totalTransfersCents = 0;

  for (const tx of transactions) {
    if (tx.transactionKind === 'INCOME') {
      totalIncomeCents = safeAdd(totalIncomeCents, tx.amountCents);
    } else if (tx.transactionKind === 'EXPENSE') {
      totalExpenseCents = safeAdd(totalExpenseCents, tx.amountCents);
    } else if (tx.transactionKind === 'TRANSFER') {
      totalTransfersCents = safeAdd(totalTransfersCents, tx.amountCents);
    }
  }

  // Transfers NEVER affect expected business balance!
  const expectedBalanceCents = safeSubtract(
    safeAdd(openingBalanceCents, totalIncomeCents),
    totalExpenseCents
  );

  const safeAllocated = Math.max(0, allocatedOpeningCents);
  const unallocatedOpeningCents = Math.max(0, safeSubtract(openingBalanceCents, safeAllocated));

  return {
    dayId,
    date,
    status,
    openingBalanceCents,
    totalIncomeCents,
    totalExpenseCents,
    totalTransfersCents,
    expectedBalanceCents,
    allocatedOpeningCents: safeAllocated,
    unallocatedOpeningCents,
  };
}

/**
 * Calculates summary for a specific Day object and its transactions.
 */
export function calculateDaySummary(
  day: Day,
  dayTransactions: Transaction[],
  machines: MachineAccount[] = []
): DailySummary {
  let allocatedOpeningCents = 0;
  if (day.machineOpeningBalances && Object.keys(day.machineOpeningBalances).length > 0) {
    allocatedOpeningCents = Object.values(day.machineOpeningBalances).reduce(
      (acc, bal) => safeAdd(acc, bal),
      0
    );
  } else if (machines.length > 0) {
    allocatedOpeningCents = machines.reduce((acc, m) => safeAdd(acc, m.initialBalanceCents), 0);
  }

  return calculateDailySummary(
    day.openingBusinessBalanceCents,
    dayTransactions,
    day.date,
    day.id,
    day.status,
    allocatedOpeningCents
  );
}

/**
 * Calculates current balance for an individual machine or account from its initial balance.
 */
export function calculateMachineClosingBalance(
  machineId: string,
  initialBalanceCents: number,
  transactions: Transaction[]
): number {
  let balance = initialBalanceCents || 0;

  for (const tx of transactions) {
    if (tx.transactionKind === 'INCOME') {
      if (tx.destinationMachineAccountId === machineId) {
        balance = safeAdd(balance, tx.amountCents);
      }
    } else if (tx.transactionKind === 'EXPENSE') {
      if (tx.sourceMachineAccountId === machineId) {
        balance = safeSubtract(balance, tx.amountCents);
      }
    } else if (tx.transactionKind === 'TRANSFER') {
      if (tx.sourceMachineAccountId === machineId) {
        balance = safeSubtract(balance, tx.amountCents);
      }
      if (tx.destinationMachineAccountId === machineId) {
        balance = safeAdd(balance, tx.amountCents);
      }
    }
  }

  return balance;
}

/**
 * Calculates current balance for an individual machine or account.
 */
export function calculateMachineBalance(
  machine: MachineAccount,
  transactions: Transaction[],
  dayMachineOpeningBalance?: number
): number {
  const initial = dayMachineOpeningBalance !== undefined ? dayMachineOpeningBalance : machine.initialBalanceCents;
  return calculateMachineClosingBalance(machine.id, initial, transactions);
}

/**
 * End-of-day reconciliation calculation
 * Compares expected balance (Opening + Real Income - Real Expense) against physically counted cash.
 * Transfers do not alter the expected business total.
 */
export function calculateReconciliation(
  expectedBalanceCents: number,
  actualCountedCents: number | null
): Reconciliation {
  if (actualCountedCents === null) {
    return {
      expectedBalanceCents,
      actualCountedCents: null,
      differenceCents: null,
      isMatched: false,
      statusText: 'بانتظار العد',
    };
  }

  const differenceCents = safeSubtract(actualCountedCents, expectedBalanceCents);
  const isMatched = differenceCents === 0;

  let statusText: 'متطابق' | 'عجز' | 'زيادة' | 'بانتظار العد' = 'متطابق';
  if (differenceCents < 0) {
    statusText = 'عجز';
  } else if (differenceCents > 0) {
    statusText = 'زيادة';
  }

  return {
    expectedBalanceCents,
    actualCountedCents,
    differenceCents,
    isMatched,
    statusText,
  };
}

/**
 * Pre-condition checks before starting a new day:
 * 1. Previous day must be CLOSED.
 * 2. Previous day must have actual counted balance.
 * 3. Previous day's transactions must all be valid.
 */
export function validateStartNextDay(
  previousDay: Day | null,
  dayTransactions: Transaction[] = []
): { valid: boolean; error?: string } {
  if (!previousDay) return { valid: true };

  if (previousDay.status !== 'CLOSED') {
    return {
      valid: false,
      error: 'لا يمكن بدء يوم جديد لأن اليوم الحالي ما زال مفتوحاً. يجب إغلاق اليوم أولاً.',
    };
  }

  if (previousDay.actualClosingBalanceCents === null) {
    return {
      valid: false,
      error: 'يجب تسجيل العد الفعلي للنقدية وإغلاق اليوم السابق قبل بدء يوم جديد.',
    };
  }

  for (const tx of dayTransactions) {
    const res = validateTransaction(tx);
    if (!res.valid) {
      return {
        valid: false,
        error: `يوجد حركة غير صالحة في اليوم السابق (${tx.id}): ${res.error}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Formats an ISO timestamp or date into friendly Arabic representation
 */
export function formatArabicDate(dateObj: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(dateObj);
  } catch {
    return dateObj.toLocaleDateString();
  }
}

export function formatArabicTime(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
    return new Intl.DateTimeFormat('ar-EG', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return '';
  }
}
