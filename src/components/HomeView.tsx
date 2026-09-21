import React from 'react';
import {
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Wallet,
  Smartphone,
  ChevronLeft,
  Edit2,
  Calendar,
  Sparkles,
  Info,
  Lock,
  Unlock,
  Play,
  Scale,
  Eye,
} from 'lucide-react';
import { useCash } from '../context/CashContext';
import { formatCurrency, formatEGP } from '../utils/money';
import { formatArabicDate, formatArabicTime } from '../utils/calculations';

export const HomeView: React.FC = () => {
  const {
    dailySummary,
    machines,
    machineBalances,
    transactions,
    activeDay,
    currentDay,
    viewingDayId,
    setViewingDayId,
    isCurrentDayClosed,
    isViewingHistoricalDay,
    setIsAddTransactionOpen,
    setIsEditOpeningBalanceOpen,
    setIsCloseDayModalOpen,
    setIsStartDayModalOpen,
    setEditingTransaction,
    setActiveTab,
  } = useCash();

  const todayArabic = formatArabicDate();
  const recentTransactions = transactions.slice(0, 6);

  const machineMap = new Map(machines.map((m) => [m.id, m.name]));

  return (
    <div className="space-y-6 pb-24">
      {/* Top Welcome & Day Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-black text-stone-900 tracking-tight">
              {isViewingHistoricalDay ? `سجل يوم ${currentDay?.date}` : 'يومية اليوم'}
            </h2>

            {/* Status Badge */}
            <span
              id="day-status-badge"
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                !currentDay
                  ? 'bg-stone-100 text-stone-600'
                  : isCurrentDayClosed
                  ? 'bg-stone-200 text-stone-700'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {!currentDay ? (
                <span>لا يوجد يوم نشط</span>
              ) : isCurrentDayClosed ? (
                <>
                  <Lock className="w-3 h-3" />
                  <span>اليوم مغلق</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3 h-3 text-emerald-600" />
                  <span>اليوم مفتوح</span>
                </>
              )}
            </span>

            {isViewingHistoricalDay && (
              <span className="text-xs px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-semibold">
                أرشيف للقراءة
              </span>
            )}
          </div>

          <p className="text-sm text-stone-500 font-medium flex items-center gap-1.5 mt-1">
            <Calendar className="w-4 h-4 text-stone-400" />
            <span>{todayArabic}</span>
          </p>
        </div>

        {/* Action Controls for Day */}
        <div className="flex items-center gap-2">
          {isViewingHistoricalDay ? (
            <button
              id="return-to-active-day-btn"
              type="button"
              onClick={() => setViewingDayId(null)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-stone-900 hover:bg-black text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>العودة لليوم النشط</span>
            </button>
          ) : isCurrentDayClosed ? (
            <button
              id="home-start-next-day-btn"
              type="button"
              onClick={() => setIsStartDayModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>بدء يوم جديد</span>
            </button>
          ) : !currentDay ? (
            <button
              id="home-start-first-day-btn"
              type="button"
              onClick={() => setIsStartDayModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>بدء أول يوم عمل</span>
            </button>
          ) : (
            <>
              <button
                id="home-close-day-btn"
                type="button"
                onClick={() => setIsCloseDayModalOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>إغلاق اليوم</span>
              </button>

              <button
                id="home-top-add-tx-btn"
                type="button"
                onClick={() => setIsAddTransactionOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>إضافة حركة</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Zero State / Uninitialized Banner */}
      {!currentDay && (
        <div
          id="day-uninitialized-notice-banner"
          className="p-4 rounded-2xl bg-stone-100 border border-stone-200 text-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-stone-200 text-stone-700 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-stone-900">النظام في حالة الصفر (لا توجد أيام مسجلة)</h4>
              <p className="text-xs text-stone-500 mt-0.5">
                لم يتم تسجيل أي يومية حتى الآن. اضغط على &quot;بدء أول يوم عمل&quot; لتهيئة اليومية الأولى.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Closed Day Notice Banner */}
      {isCurrentDayClosed && (
        <div
          id="day-closed-notice-banner"
          className="p-4 rounded-2xl bg-stone-100 border border-stone-300 text-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-stone-800 text-amber-400 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-stone-900">تم إغلاق يومية هذا اليوم</h4>
              <p className="text-xs text-stone-600 mt-0.5">
                الرصيد الفعلي المعدود تم تثبيته ({formatEGP(currentDay?.actualClosingBalanceCents || 0)}). لبدء تسجيل حركات جديدة، ابدأ يوم جديد.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsStartDayModalOpen(true)}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shrink-0 transition-colors shadow-xs"
          >
            بدء يوم جديد الآن
          </button>
        </div>
      )}

      {/* Primary Expected Balance Card */}
      <div
        id="expected-balance-hero-card"
        className="relative overflow-hidden rounded-2xl bg-stone-900 text-white p-5 sm:p-6 shadow-md border border-stone-800"
      >
        <div className="flex items-center justify-between text-stone-300 mb-2">
          <span className="text-xs font-semibold tracking-wider text-stone-400 uppercase">
            الرصيد الفعلي المتوقع للنشاط بالكامل
          </span>
          <span className="text-xs px-2.5 py-0.5 bg-stone-800 rounded-md font-mono text-amber-400 font-bold">
            رصيد البداية + الداخل الحقيقي - الخارج الحقيقي
          </span>
        </div>

        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white font-mono">
            {formatCurrency(dailySummary.expectedBalanceCents, { showCurrency: false })}
          </span>
          <span className="text-xl font-bold text-stone-400">ج.م</span>
        </div>

        {dailySummary.unallocatedOpeningCents > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-stone-800/90 text-stone-300 text-xs border border-stone-700/60">
            <span className="text-stone-400">منها رصيد غير موزع على الماكينات:</span>
            <span className="font-mono font-bold text-amber-300">
              {formatCurrency(dailySummary.unallocatedOpeningCents)}
            </span>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-stone-800 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>التحويلات الداخلية بين الماكينات لها صفر تأثير على هذا الرصيد</span>
          </div>
          <button
            id="home-check-reconciliation-btn"
            type="button"
            onClick={() => setActiveTab('reconciliation')}
            className="text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>مطابقة النقدية والجرد</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main 3 Financial Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Opening Balance */}
        <div
          id="card-opening-balance"
          className="rounded-xl bg-white p-4 border border-stone-200 shadow-xs relative group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-stone-600">رصيد بداية اليوم</span>
            {currentDay && !isCurrentDayClosed && (
              <button
                id="edit-opening-balance-btn"
                type="button"
                onClick={() => setIsEditOpeningBalanceOpen(true)}
                title="تعديل رصيد بداية اليوم"
                className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-md transition-colors cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="text-xl font-black text-stone-900 font-mono">
            {formatCurrency(dailySummary.openingBalanceCents)}
          </div>
          <div className="text-[11px] text-stone-400 mt-1">المبلغ المفتتح به النشاط</div>
          {dailySummary.openingBalanceCents > 0 && (
            <div className="mt-2.5 pt-2 border-t border-stone-100 space-y-1 text-[11px]">
              <div className="flex items-center justify-between text-stone-500">
                <span>الموزع بالماكينات:</span>
                <span className="font-mono font-bold text-stone-800">
                  {formatCurrency(dailySummary.allocatedOpeningCents)}
                </span>
              </div>
              <div className="flex items-center justify-between text-stone-500">
                <span>المتبقي غير الموزع:</span>
                <span className="font-mono font-bold text-emerald-700">
                  {formatCurrency(dailySummary.unallocatedOpeningCents)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Total Inflows (دخل حقيقي) */}
        <div
          id="card-total-income"
          className="rounded-xl bg-emerald-50/70 p-4 border border-emerald-200 shadow-xs"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-emerald-900">إجمالي الداخل الحقيقي (+)</span>
            <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
              <ArrowDownLeft className="w-3.5 h-3.5 stroke-[2.5]" />
            </div>
          </div>
          <div className="text-xl font-black text-emerald-700 font-mono">
            +{formatCurrency(dailySummary.totalIncomeCents)}
          </div>
          <div className="text-[11px] text-emerald-800/80 mt-1">أقساط، شحنات، ومكاسب النشاط</div>
        </div>

        {/* Total Outflows (خرج حقيقي) */}
        <div
          id="card-total-expense"
          className="rounded-xl bg-rose-50/70 p-4 border border-rose-200 shadow-xs"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-rose-900">إجمالي الخارج الحقيقي (-)</span>
            <div className="w-6 h-6 rounded-full bg-rose-100 flex items-center justify-center text-rose-700">
              <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
            </div>
          </div>
          <div className="text-xl font-black text-rose-700 font-mono">
            -{formatCurrency(dailySummary.totalExpenseCents)}
          </div>
          <div className="text-[11px] text-rose-800/80 mt-1">شكك، مصاريف، وسحوبات شخصية</div>
        </div>
      </div>

      {/* Internal Transfers Bar */}
      <div
        id="home-transfers-banner"
        className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs"
      >
        <div className="flex items-center gap-2 text-amber-900">
          <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
            <ArrowLeftRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </div>
          <div>
            <span className="font-bold">حجم التحويلات الداخلية بين الماكينات: </span>
            <span className="font-mono font-black text-amber-950 text-sm">
              {formatCurrency(dailySummary.totalTransfersCents || 0)}
            </span>
          </div>
        </div>
        <div className="text-amber-800 text-[11px] font-medium flex items-center gap-1">
          <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>التحويل ينقل الفلوس بين الماكينات فقط ولا يغيّر إجمالي فلوس النشاط.</span>
        </div>
      </div>

      {/* Machines & Accounts Section (أرصدة الماكينات) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-stone-700" />
            <h3 className="text-base font-bold text-stone-900">أرصدة الماكينات والحسابات</h3>
          </div>
          <button
            id="home-view-all-machines-btn"
            type="button"
            onClick={() => setActiveTab('machines')}
            className="text-xs font-semibold text-emerald-800 hover:text-emerald-900 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>إدارة الماكينات</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        {machines.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-stone-300 p-6 text-center text-xs text-stone-500">
            لا توجد أي ماكينات أو حسابات مضافة حالياً.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {machines.map((machine) => {
              const balance = machineBalances[machine.id] ?? machine.initialBalanceCents;
              return (
                <div
                  key={machine.id}
                  id={`machine-summary-${machine.id}`}
                  className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs flex items-center justify-between hover:border-stone-300 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-stone-100 text-stone-800 flex items-center justify-center font-bold text-sm">
                      {machine.name.slice(0, 2)}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-stone-900">{machine.name}</h4>
                      <span className="text-[11px] font-medium text-stone-500 flex items-center gap-1 mt-0.5">
                        بداية اليوم: {formatCurrency(currentDay?.machineOpeningBalances?.[machine.id] ?? machine.initialBalanceCents)}
                      </span>
                    </div>
                  </div>

                  <div className="text-left font-mono">
                    <div className="text-base font-bold text-stone-900">
                      {formatCurrency(balance)}
                    </div>
                    <div className="text-[10px] text-stone-500 font-sans">الرصيد المشتق</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Transactions Section (آخر الحركات) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-stone-700" />
            <h3 className="text-base font-bold text-stone-900">
              آخر الحركات المسجلة ({transactions.length})
            </h3>
          </div>
          <button
            id="home-view-all-tx-btn"
            type="button"
            onClick={() => setActiveTab('transactions')}
            className="text-xs font-semibold text-emerald-800 hover:text-emerald-900 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>كل حركات اليوم</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-stone-300 p-8 text-center">
            <Sparkles className="w-8 h-8 text-stone-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-stone-700">لا توجد حركات مسجلة حتى الآن اليوم</p>
            {currentDay && !isCurrentDayClosed && (
              <>
                <p className="text-xs text-stone-400 mt-1">اضغط على زر إضافة حركة لتسجيل أول حركة</p>
                <button
                  id="home-empty-add-btn"
                  type="button"
                  onClick={() => setIsAddTransactionOpen(true)}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة حركة الآن</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-stone-200 shadow-xs divide-y divide-stone-100 overflow-hidden">
            {recentTransactions.map((tx) => {
              const isIncome = tx.transactionKind === 'INCOME';
              const isExpense = tx.transactionKind === 'EXPENSE';
              const isTransfer = tx.transactionKind === 'TRANSFER';

              const sourceName = tx.sourceMachineAccountId ? machineMap.get(tx.sourceMachineAccountId) : undefined;
              const destName = tx.destinationMachineAccountId ? machineMap.get(tx.destinationMachineAccountId) : undefined;

              return (
                <div
                  key={tx.id}
                  id={`recent-tx-${tx.id}`}
                  onClick={() => {
                    if (!isCurrentDayClosed) {
                      setEditingTransaction(tx);
                    }
                  }}
                  className={`p-3.5 flex items-center justify-between gap-3 transition-colors ${
                    isCurrentDayClosed
                      ? 'cursor-default'
                      : 'hover:bg-stone-50/70 cursor-pointer'
                  }`}
                  title={isCurrentDayClosed ? 'اليوم مغلق' : 'انقر لتعديل الحركة'}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-stone-900">{tx.category}</span>
                        {isTransfer && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/60 font-semibold">
                            من {sourceName} إلى {destName}
                          </span>
                        )}
                        {isIncome && destName && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/50">
                            إلى {destName}
                          </span>
                        )}
                        {isExpense && sourceName && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200/50">
                            من {sourceName}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-stone-500 truncate mt-0.5 max-w-xs sm:max-w-md">
                        {tx.description || (isTransfer ? 'تحويل بين الماكينات' : 'بدون بيان')}
                      </p>
                      <span className="text-[10px] text-stone-400 mt-0.5 block">
                        {formatArabicTime(tx.timestamp)}
                      </span>
                    </div>
                  </div>

                  <div className="text-left font-mono shrink-0">
                    <span
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
                    </span>
                    {isTransfer && (
                      <span className="text-[10px] text-stone-400 font-sans block text-left">
                        تحويل داخلي
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Action Button for Mobile when open */}
      {currentDay && !isCurrentDayClosed && (
        <div className="fixed bottom-20 start-4 end-4 sm:hidden z-20 pointer-events-none">
          <button
            id="mobile-fab-add-tx"
            type="button"
            onClick={() => setIsAddTransactionOpen(true)}
            className="pointer-events-auto w-full flex items-center justify-center gap-2 py-3.5 px-6 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-bold text-base rounded-2xl shadow-xl transition-all active:scale-[0.98] cursor-pointer"
          >
            <Plus className="w-5 h-5 stroke-[3]" />
            <span>+ إضافة حركة نقدية</span>
          </button>
        </div>
      )}
    </div>
  );
};
