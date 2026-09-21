import React, { useState, useMemo } from 'react';
import {
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Filter,
  Trash2,
  Edit2,
  Search,
  CheckCircle2,
  Lock,
  Eye,
} from 'lucide-react';
import { useCash } from '../context/CashContext';
import { TransactionFilter, Transaction } from '../types';
import { formatCurrency, formatEGP } from '../utils/money';
import { formatArabicTime } from '../utils/calculations';

export const TransactionsView: React.FC = () => {
  const {
    transactions,
    machines,
    setEditingTransaction,
    setDeletingTransaction,
    setIsAddTransactionOpen,
    isCurrentDayClosed,
    isViewingHistoricalDay,
    currentDay,
    setViewingDayId,
  } = useCash();

  const [filter, setFilter] = useState<TransactionFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const machineMap = useMemo(() => {
    return new Map(machines.map((m) => [m.id, m.name]));
  }, [machines]);

  // Filtering
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Kind filter
      if (filter === 'income' && tx.transactionKind !== 'INCOME') return false;
      if (filter === 'expense' && tx.transactionKind !== 'EXPENSE') return false;
      if (filter === 'transfer' && tx.transactionKind !== 'TRANSFER') return false;

      // Text query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const categoryMatch = tx.category.toLowerCase().includes(query);
        const descMatch = tx.description.toLowerCase().includes(query);
        const sourceName = tx.sourceMachineAccountId ? machineMap.get(tx.sourceMachineAccountId) || '' : '';
        const destName = tx.destinationMachineAccountId ? machineMap.get(tx.destinationMachineAccountId) || '' : '';
        const machineMatch =
          sourceName.toLowerCase().includes(query) || destName.toLowerCase().includes(query);

        return categoryMatch || descMatch || machineMatch;
      }

      return true;
    });
  }, [transactions, filter, searchQuery, machineMap]);

  // Totals for filtered view
  const { filteredIncome, filteredExpense, filteredTransfers } = useMemo(() => {
    let income = 0;
    let expense = 0;
    let transfers = 0;

    for (const tx of filteredTransactions) {
      if (tx.transactionKind === 'INCOME') {
        income += tx.amountCents;
      } else if (tx.transactionKind === 'EXPENSE') {
        expense += tx.amountCents;
      } else if (tx.transactionKind === 'TRANSFER') {
        transfers += tx.amountCents;
      }
    }

    return { filteredIncome: income, filteredExpense: expense, filteredTransfers: transfers };
  }, [filteredTransactions]);

  const renderMachineDetails = (tx: Transaction) => {
    if (tx.transactionKind === 'TRANSFER') {
      const src = machineMap.get(tx.sourceMachineAccountId || '') || 'ماكينة غير محددة';
      const dest = machineMap.get(tx.destinationMachineAccountId || '') || 'ماكينة غير محددة';
      return (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200/60 font-semibold">
          <span className="text-amber-700">من:</span> {src}
          <span className="text-stone-400">⬅️</span>
          <span className="text-amber-700">إلى:</span> {dest}
        </span>
      );
    }

    if (tx.transactionKind === 'INCOME' && tx.destinationMachineAccountId) {
      const dest = machineMap.get(tx.destinationMachineAccountId);
      return (
        <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200/50 font-medium">
          إلى: {dest}
        </span>
      );
    }

    if (tx.transactionKind === 'EXPENSE' && tx.sourceMachineAccountId) {
      const src = machineMap.get(tx.sourceMachineAccountId);
      return (
        <span className="text-[11px] px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200/50 font-medium">
          من: {src}
        </span>
      );
    }

    return null;
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Historical Day Banner */}
      {isViewingHistoricalDay && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-700 shrink-0" />
            <span>أنت تستعرض حركات يوم <strong>{currentDay?.date}</strong> (للقراءة فقط).</span>
          </div>
          <button
            type="button"
            onClick={() => setViewingDayId(null)}
            className="px-3 py-1.5 bg-amber-200 hover:bg-amber-300 text-amber-900 font-bold rounded-lg text-xs transition-colors"
          >
            العودة لليوم النشط
          </button>
        </div>
      )}

      {/* Closed Day Notice */}
      {isCurrentDayClosed && !isViewingHistoricalDay && (
        <div className="p-3 rounded-xl bg-stone-100 border border-stone-200 text-stone-700 text-xs flex items-center gap-2">
          <Lock className="w-4 h-4 text-stone-500 shrink-0" />
          <span>هذا اليوم مغلق حالياً. تم قفل إضافة وتعديل الحركات لحماية السجلات المالية.</span>
        </div>
      )}

      {/* Header & Title */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div>
          <h2 className="text-2xl font-black text-stone-900 tracking-tight">سجل الحركات</h2>
          <p className="text-xs text-stone-500 font-medium mt-0.5">
            حركات اليومية النقدية والتحويلات الداخلية بين الماكينات ({transactions.length} حركة)
          </p>
        </div>

        {!isCurrentDayClosed && (
          <button
            id="tx-view-add-btn"
            type="button"
            onClick={() => setIsAddTransactionOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>+ إضافة حركة</span>
          </button>
        )}
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-white p-2 rounded-xl border border-stone-200 shadow-xs flex flex-col sm:flex-row gap-2 justify-between items-stretch sm:items-center">
        {/* Type Segment Control */}
        <div className="flex bg-stone-100 p-1 rounded-lg gap-1 overflow-x-auto">
          <button
            id="filter-all-btn"
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all whitespace-nowrap cursor-pointer ${
              filter === 'all'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            الكل ({transactions.length})
          </button>
          <button
            id="filter-income-btn"
            type="button"
            onClick={() => setFilter('income')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              filter === 'income'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>داخل (إيراد)</span>
          </button>
          <button
            id="filter-expense-btn"
            type="button"
            onClick={() => setFilter('expense')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              filter === 'expense'
                ? 'bg-rose-700 text-white shadow-xs'
                : 'text-rose-700 hover:bg-rose-50'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>خارج (مصروف)</span>
          </button>
          <button
            id="filter-transfer-btn"
            type="button"
            onClick={() => setFilter('transfer')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              filter === 'transfer'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-amber-800 hover:bg-amber-50'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>تحويل بين الماكينات</span>
          </button>
        </div>

        {/* Quick Search */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-4 h-4 text-stone-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            id="tx-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالتصنيف أو البيان أو الماكينة..."
            className="w-full ps-9 pe-3 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:border-emerald-600 focus:bg-white text-stone-900"
          />
        </div>
      </div>

      {/* Filtered Sub-Total bar */}
      <div className="bg-stone-100/90 px-4 py-2 rounded-lg text-xs flex flex-wrap items-center justify-between gap-2 text-stone-600 border border-stone-200/50">
        <span>المعروض: {filteredTransactions.length} حركة</span>
        <div className="flex flex-wrap items-center gap-3 font-mono font-bold text-xs">
          {filter !== 'expense' && filter !== 'transfer' && (
            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/50">
              دخل: +{formatCurrency(filteredIncome)}
            </span>
          )}
          {filter !== 'income' && filter !== 'transfer' && (
            <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200/50">
              خرج: -{formatCurrency(filteredExpense)}
            </span>
          )}
          {(filter === 'all' || filter === 'transfer') && filteredTransfers > 0 && (
            <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60 font-semibold" title="تحويلات داخلية لا تؤثر على إجمالي النشاط">
              تحويلات داخلية: ↔ {formatCurrency(filteredTransfers)} (صفر تأثير على النشاط)
            </span>
          )}
        </div>
      </div>

      {/* Transactions List */}
      {filteredTransactions.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-stone-300 p-10 text-center">
          <Filter className="w-8 h-8 text-stone-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-stone-700">لا توجد حركات تطابق الفلتر المحدد</p>
          <p className="text-xs text-stone-400 mt-1">جرب تغيير الفلتر أو إضافة حركة جديدة</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 shadow-xs divide-y divide-stone-100 overflow-hidden">
          {filteredTransactions.map((tx) => {
            const isIncome = tx.transactionKind === 'INCOME';
            const isExpense = tx.transactionKind === 'EXPENSE';
            const isTransfer = tx.transactionKind === 'TRANSFER';

            return (
              <div
                key={tx.id}
                id={`tx-row-${tx.id}`}
                className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-stone-50/70 transition-colors"
              >
                {/* Right side: icon & details */}
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      isIncome
                        ? 'bg-emerald-100 text-emerald-700'
                        : isExpense
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {isIncome && <ArrowDownLeft className="w-4 h-4 stroke-[2.5]" />}
                    {isExpense && <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />}
                    {isTransfer && <ArrowLeftRight className="w-4 h-4 stroke-[2.5]" />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-md font-bold ${
                          isIncome
                            ? 'bg-emerald-100/70 text-emerald-800'
                            : isExpense
                            ? 'bg-rose-100/70 text-rose-800'
                            : 'bg-amber-100/80 text-amber-900'
                        }`}
                      >
                        {tx.category}
                      </span>

                      {renderMachineDetails(tx)}

                      <span className="text-[11px] text-stone-400">
                        {formatArabicTime(tx.timestamp)}
                      </span>
                    </div>

                    <p className="text-xs text-stone-700 font-medium mt-1 leading-relaxed truncate max-w-sm sm:max-w-md">
                      {tx.description || (isTransfer ? 'تحويل بين الماكينات' : 'بدون بيان تفصيلي')}
                    </p>
                  </div>
                </div>

                {/* Left side: Amount, Status badge, Edit & Delete */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  <div className="text-left font-mono">
                    <div
                      className={`text-sm sm:text-base font-bold ${
                        isIncome
                          ? 'text-emerald-700'
                          : isExpense
                          ? 'text-rose-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {isIncome && `+${formatCurrency(tx.amountCents)}`}
                      {isExpense && `-${formatCurrency(tx.amountCents)}`}
                      {isTransfer && `↔ ${formatCurrency(tx.amountCents)}`}
                    </div>
                    {isTransfer && (
                      <span className="text-[10px] text-stone-400 font-sans block text-left">
                        تحويل داخلي
                      </span>
                    )}
                  </div>

                  {/* Actions: Edit & Delete (hidden if day is closed) */}
                  {!isCurrentDayClosed && (
                    <div className="flex items-center gap-1">
                      <button
                        id={`edit-tx-${tx.id}`}
                        type="button"
                        onClick={() => setEditingTransaction(tx)}
                        title="تعديل الحركة"
                        className="p-1.5 text-stone-400 hover:text-stone-800 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        id={`delete-tx-${tx.id}`}
                        type="button"
                        onClick={() => setDeletingTransaction(tx)}
                        title="حذف الحركة"
                        className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
