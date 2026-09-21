import React, { useState, useEffect } from 'react';
import {
  Scale,
  CheckCircle2,
  AlertTriangle,
  ArrowUpDown,
  Plus,
  Minus,
  Equal,
  Sparkles,
  HelpCircle,
  ArrowLeftRight,
  Info,
  Lock,
} from 'lucide-react';
import { useCash } from '../context/CashContext';
import { formatCurrency, parseAmountToCents, fromCents } from '../utils/money';

export const ReconciliationView: React.FC = () => {
  const {
    dailySummary,
    actualCountedCents,
    setActualCounted,
    reconciliation,
    machines,
    machineBalances,
    setActiveTab,
    isCurrentDayClosed,
    setIsCloseDayModalOpen,
  } = useCash();

  // Local state for the input field
  const [inputValue, setInputValue] = useState<string>(() => {
    if (actualCountedCents !== null) {
      return String(fromCents(actualCountedCents));
    }
    return '';
  });
  const [inputError, setInputError] = useState<string | null>(null);

  // Sync if context changes externally
  useEffect(() => {
    if (actualCountedCents !== null) {
      setInputValue(String(fromCents(actualCountedCents)));
    }
  }, [actualCountedCents]);

  const handleApplyCount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) {
      setActualCounted(null);
      setInputError(null);
      return;
    }

    const res = parseAmountToCents(inputValue);
    if (res.error) {
      setInputError(res.error);
    } else {
      setInputError(null);
      setActualCounted(res.cents);
    }
  };

  const handleQuickMatch = () => {
    setInputValue(String(fromCents(dailySummary.expectedBalanceCents)));
    setActualCounted(dailySummary.expectedBalanceCents);
    setInputError(null);
  };

  const handleClearActual = () => {
    setInputValue('');
    setActualCounted(null);
    setInputError(null);
  };

  const hasEnteredActual = reconciliation.actualCountedCents !== null;
  const isExactMatch = reconciliation.isMatched;
  const diffCents = reconciliation.differenceCents ?? 0;
  const isShortage = diffCents < 0; // عجز
  const isSurplus = diffCents > 0; // زيادة

  // Sum of machine balances
  const totalMachinesCalculated = Object.values(machineBalances).reduce((acc, val) => acc + val, 0);

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="pt-1">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-black text-stone-900 tracking-tight">المراجعة ومطابقة اليومية</h2>
          <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-stone-100 text-stone-700">
            نهاية اليوم
          </span>
        </div>
        <p className="text-xs text-stone-500 font-medium mt-1">
          مقارنة النقدية الفعلية الموجودة في الدرج والماكينات مع الرصيد المتوقع دفترياً
        </p>
      </div>

      {/* 1. Mathematical Breakdown Workflow */}
      <div className="bg-white rounded-2xl p-5 border border-stone-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-stone-700 uppercase tracking-wider">
            معادلة احتساب رصيد النشاط المتوقع:
          </h3>
          <span className="text-[11px] font-mono text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
            بداية + داخل حقيقي - خارج حقيقي
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          {/* Opening Balance */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-stone-100">
            <div className="flex items-center gap-2 text-stone-800 font-bold text-sm">
              <span className="w-6 h-6 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center text-xs font-mono">
                1
              </span>
              <span>رصيد بداية اليوم</span>
            </div>
            <div className="font-mono font-black text-stone-900 text-base">
              {formatCurrency(dailySummary.openingBalanceCents)}
            </div>
          </div>

          {/* Plus Inflows */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50/70 border border-emerald-100">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
              <span className="w-6 h-6 rounded-full bg-emerald-200 text-emerald-800 flex items-center justify-center text-xs font-bold">
                <Plus className="w-3.5 h-3.5" />
              </span>
              <span>إجمالي الداخل الحقيقي (أقساط، شحنات، إيرادات)</span>
            </div>
            <div className="font-mono font-black text-emerald-700 text-base">
              +{formatCurrency(dailySummary.totalIncomeCents)}
            </div>
          </div>

          {/* Minus Outflows */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-rose-50/70 border border-rose-100">
            <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
              <span className="w-6 h-6 rounded-full bg-rose-200 text-rose-800 flex items-center justify-center text-xs font-bold">
                <Minus className="w-3.5 h-3.5" />
              </span>
              <span>إجمالي الخارج الحقيقي (شكك، مصاريف، سحب شخصي)</span>
            </div>
            <div className="font-mono font-black text-rose-700 text-base">
              -{formatCurrency(dailySummary.totalExpenseCents)}
            </div>
          </div>

          {/* Internal Transfers Note */}
          <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/60 flex items-center justify-between text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                التحويلات الداخلية ({formatCurrency(dailySummary.totalTransfersCents || 0)}):
                <strong className="ms-1">مستبعدة من المعادلة</strong> لأنها نقل داخلي لا يغير إجمالي الفلوس.
              </span>
            </div>
            <span className="font-mono font-bold text-amber-700">تأثير = 0</span>
          </div>

          {/* Equals Expected Balance */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-stone-900 text-white shadow-xs">
            <div className="flex items-center gap-2 font-bold text-sm">
              <span className="w-6 h-6 rounded-full bg-amber-400 text-stone-900 flex items-center justify-center text-xs font-bold">
                <Equal className="w-4 h-4" />
              </span>
              <span className="text-stone-200">الرصيد المتوقع دفترياً</span>
            </div>
            <div className="font-mono font-black text-amber-400 text-xl sm:text-2xl">
              {formatCurrency(dailySummary.expectedBalanceCents)}
            </div>
          </div>
        </div>
      </div>

      {/* Machine Balances Verification Helper */}
      <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200 space-y-2">
        <div className="flex items-center justify-between text-xs text-stone-600">
          <span className="font-bold text-stone-800">توزيع الأرصدة المحسوبة في الماكينات والحسابات:</span>
          <span className="font-mono font-black text-stone-900 text-sm">
            المجموع: {formatCurrency(totalMachinesCalculated)}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {machines.map((m) => (
            <div key={m.id} className="bg-white p-2.5 rounded-lg border border-stone-200">
              <div className="text-stone-500 truncate text-[11px]">{m.name}</div>
              <div className="font-mono font-bold text-stone-900 mt-0.5">
                {formatCurrency(machineBalances[m.id] ?? m.initialBalanceCents)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Actual Counted Input Section */}
      <div className="bg-white rounded-2xl p-5 border border-stone-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <label htmlFor="actual-counted-input" className="text-sm font-bold text-stone-900 block">
            المبلغ الفعلي الموجود (العد الفعلي والجرد)
          </label>
          <span className="text-xs text-stone-500">كاش الدرج + إجمالي أرصدة الماكينات الحالية</span>
        </div>

        <form onSubmit={handleApplyCount} className="space-y-3">
          <div className="relative">
            <input
              id="actual-counted-input"
              type="text"
              inputMode="decimal"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputError(null);
              }}
              placeholder="اكتب المبلغ الفعلي المحسوب (مثال: 5905)"
              className="w-full text-xl sm:text-2xl font-bold font-mono py-3.5 ps-4 pe-16 bg-stone-50 border-2 border-stone-200 rounded-xl focus:outline-none focus:border-stone-900 focus:bg-white text-stone-900 placeholder:text-stone-300 transition-colors"
            />
            <span className="absolute end-4 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400 font-mono">
              ج.م
            </span>
          </div>

          {inputError && (
            <p className="text-xs font-bold text-rose-600 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{inputError}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              id="submit-reconcile-btn"
              type="submit"
              className="flex-1 py-2.5 px-4 bg-stone-900 hover:bg-stone-800 active:bg-black text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              حساب ومطابقة الفرق
            </button>

            <button
              id="quick-match-helper-btn"
              type="button"
              onClick={handleQuickMatch}
              className="py-2.5 px-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              title="تعبئة نفس المتوقع إذا كان العد متطابقاً تماماً"
            >
              مطابقة مع المتوقع
            </button>

            {hasEnteredActual && (
              <button
                id="clear-reconcile-btn"
                type="button"
                onClick={handleClearActual}
                className="py-2.5 px-3 text-stone-400 hover:text-stone-700 text-xs font-medium rounded-xl transition-colors cursor-pointer"
              >
                مسح العد
              </button>
            )}
          </div>
        </form>
      </div>

      {/* 3. Reconciliation Result Section */}
      {hasEnteredActual ? (
        <div
          id="reconciliation-result-card"
          className={`rounded-2xl p-6 border-2 transition-all shadow-xs ${
            isExactMatch
              ? 'bg-emerald-50/90 border-emerald-500 text-emerald-950'
              : isShortage
              ? 'bg-rose-50/90 border-rose-500 text-rose-950'
              : 'bg-amber-50/90 border-amber-500 text-amber-950'
          }`}
        >
          {/* Status Badge */}
          <div className="flex items-center justify-between gap-2 mb-4 pb-4 border-b border-current/15">
            <div className="flex items-center gap-3">
              {isExactMatch ? (
                <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                  <CheckCircle2 className="w-7 h-7 stroke-[2.5]" />
                </div>
              ) : (
                <div
                  className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center shadow-xs ${
                    isShortage ? 'bg-rose-600' : 'bg-amber-600'
                  }`}
                >
                  <AlertTriangle className="w-7 h-7 stroke-[2.5]" />
                </div>
              )}

              <div>
                <h4 className="text-xl font-black tracking-tight">
                  {isExactMatch ? 'اليوم متطابق' : 'يوجد فرق'}
                </h4>
                <p className="text-xs font-medium opacity-80 mt-0.5">
                  {isExactMatch
                    ? 'النقدية الفعلية تطابق الحسابات المسجلة بدقة 100%'
                    : isShortage
                    ? 'النقدية الفعلية أقل من الحسابات الدفترية (عجز نقدية)'
                    : 'النقدية الفعلية أكثر من الحسابات الدفترية (فائض / زيادة)'}
                </p>
              </div>
            </div>

            <span
              className={`px-3 py-1 rounded-full text-xs font-black ${
                isExactMatch
                  ? 'bg-emerald-200 text-emerald-900'
                  : isShortage
                  ? 'bg-rose-200 text-rose-900'
                  : 'bg-amber-200 text-amber-900'
              }`}
            >
              {isExactMatch ? 'متطابق' : isShortage ? 'عجز' : 'زيادة'}
            </span>
          </div>

          {/* Detailed Financial Comparison */}
          <div className="grid grid-cols-3 gap-3 text-center my-3">
            <div className="bg-white/70 p-3 rounded-xl border border-current/10">
              <span className="text-[11px] font-semibold opacity-70 block">الرصيد المتوقع</span>
              <span className="text-sm sm:text-base font-bold font-mono">
                {formatCurrency(reconciliation.expectedBalanceCents)}
              </span>
            </div>

            <div className="bg-white/70 p-3 rounded-xl border border-current/10">
              <span className="text-[11px] font-semibold opacity-70 block">المبلغ الفعلي</span>
              <span className="text-sm sm:text-base font-bold font-mono">
                {formatCurrency(reconciliation.actualCountedCents!)}
              </span>
            </div>

            <div
              className={`p-3 rounded-xl font-mono font-black ${
                isExactMatch
                  ? 'bg-emerald-200/80 text-emerald-900'
                  : isShortage
                  ? 'bg-rose-200/90 text-rose-950'
                  : 'bg-amber-200/90 text-amber-950'
              }`}
            >
              <span className="text-[11px] font-semibold opacity-80 block font-sans">الفرق</span>
              <span className="text-sm sm:text-base font-bold">
                {formatCurrency(diffCents, { showSign: true })}
              </span>
            </div>
          </div>

          {/* Guidance & Direct Action: "مراجعة الحركات" */}
          <div className="mt-4 pt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs font-medium opacity-90 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 shrink-0" />
              <span>
                {isExactMatch
                  ? 'يمكنك إنهاء اليومية بأمان تام.'
                  : 'راجع الحركات المسجلة للتحقق من أي حركة منسية أو خطأ في التسجيل.'}
              </span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                id="review-transactions-action-btn"
                type="button"
                onClick={() => setActiveTab('transactions')}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 font-bold text-xs rounded-xl bg-white/80 hover:bg-white text-stone-800 transition-all shadow-xs cursor-pointer"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span>مراجعة الحركات</span>
              </button>

              {!isCurrentDayClosed && (
                <button
                  id="reconcile-close-day-action-btn"
                  type="button"
                  onClick={() => setIsCloseDayModalOpen(true)}
                  className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-2.5 font-bold text-xs sm:text-sm rounded-xl transition-all shadow-xs cursor-pointer ${
                    isExactMatch
                      ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                      : isShortage
                      ? 'bg-rose-700 hover:bg-rose-800 text-white'
                      : 'bg-amber-700 hover:bg-amber-800 text-white'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>إغلاق اليومية</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-stone-50 border border-stone-200 rounded-2xl p-6 text-center text-stone-500">
          <Scale className="w-10 h-10 text-stone-300 mx-auto mb-2" />
          <h4 className="text-sm font-bold text-stone-800">بانتظار إدخال المبلغ الفعلي</h4>
          <p className="text-xs text-stone-400 mt-1 max-w-sm mx-auto">
            قم بعد الكاش الموجود في الدرج واجمع معه أرصدة الماكينات الحالية، ثم اكتب الإجمالي أعلاه لمطابقة اليومية.
          </p>
        </div>
      )}
    </div>
  );
};
