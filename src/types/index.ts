/**
 * Core Data Models & Types for Arabic Daily Cash Management
 * Phase 2 Refined Financial Transaction Model
 */

export type TransactionKind = 'INCOME' | 'EXPENSE' | 'TRANSFER';

// Kept for backward compatibility if needed in UI helpers
export type TransactionType = 'income' | 'expense' | 'transfer';

export type DayStatus = 'OPEN' | 'CLOSED';

export interface Day {
  id: string; // e.g. 'day-2026-09-18' or timestamp
  date: string; // YYYY-MM-DD
  status: DayStatus;
  openingBusinessBalanceCents: number; // Opening business balance
  actualClosingBalanceCents: number | null; // Set during reconciliation/closing
  machineOpeningBalances: Record<string, number>; // Snapshot of machine balances at start of this day
  createdAt: string;
  closedAt: string | null;
  notes?: string;
}

export interface MachineAccount {
  id: string;
  name: string;
  initialBalanceCents: number; // Stored in integer piasters/cents to prevent float errors
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface Transaction {
  id: string;
  dayId: string; // Explicit foreign reference guaranteeing transactions belong strictly to this business day
  transactionKind: TransactionKind;
  category: string;
  amountCents: number; // Always positive integer in cents
  description: string;
  sourceMachineAccountId?: string; // Required for TRANSFER and EXPENSE, forbidden for INCOME
  destinationMachineAccountId?: string; // Required for TRANSFER and INCOME, forbidden for EXPENSE
  timestamp: string; // ISO date-time string of the transaction
  createdAt: string;
  updatedAt: string;
}

export interface DailySummary {
  dayId?: string;
  date: string;
  status?: DayStatus;
  openingBalanceCents: number;
  totalIncomeCents: number;
  totalExpenseCents: number;
  totalTransfersCents: number; // Tracked separately for audit; NEVER affects expected business balance
  expectedBalanceCents: number; // openingBalanceCents + totalIncomeCents - totalExpenseCents
  allocatedOpeningCents: number; // Total opening balance allocated to machines
  unallocatedOpeningCents: number; // Opening balance minus allocated opening balance
}

export interface Reconciliation {
  expectedBalanceCents: number;
  actualCountedCents: number | null;
  differenceCents: number | null; // actualCounted - expectedBalance
  isMatched: boolean;
  statusText: 'متطابق' | 'عجز' | 'زيادة' | 'بانتظار العد';
}

export type NavTab = 'home' | 'transactions' | 'machines' | 'reconciliation' | 'history';

export type TransactionFilter = 'all' | 'income' | 'expense' | 'transfer';

export const DEFAULT_INCOME_CATEGORIES: readonly string[] = [
  'إيراد خدمات وشحن',
  'أقساط وتحصيلات',
  'عمولات',
  'إيراد متنوع',
];

export const DEFAULT_EXPENSE_CATEGORIES: readonly string[] = [
  'مصاريف تشغيل',
  'مشتريات وبضاعة',
  'مسحوبات شخصية',
  'مصروف متنوع',
];

export const DEFAULT_TRANSFER_CATEGORY = 'تحويل بين الحسابات والماكينات';

