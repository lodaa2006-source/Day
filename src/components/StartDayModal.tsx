import React, { useState, useEffect } from 'react';
import { X, Play, ArrowRight, ShieldCheck, AlertCircle, Smartphone } from 'lucide-react';
import { useCash } from '../context/CashContext';
import { formatEGP, parseAmountToCents, fromCents, safeAdd } from '../utils/money';
import { calculateMachineClosingBalance } from '../utils/calculations';

export const StartDayModal: React.FC = () => {
  const {
    isStartDayModalOpen,
    setIsStartDayModalOpen,
    activeDay,
    allTransactions,
    machines,
    startNextDay,
    setActiveTab,
  } = useCash();

  // Find previous day's actual counted balance
  const previousActualCounted = activeDay?.actualClosingBalanceCents ?? activeDay?.openingBusinessBalanceCents ?? 0;

  const totalMachineInitial = machines.reduce((acc, m) => safeAdd(acc, m.initialBalanceCents), 0);
  const initialDefault = previousActualCounted > 0 ? previousActualCounted : totalMachineInitial;

  const [openingInput, setOpeningInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setOpeningInput(String(fromCents(initialDefault)));
  }, [initialDefault, isStartDayModalOpen]);

  if (!isStartDayModalOpen) return null;

  // Calculate machine carried-forward balances
  const prevTxs = activeDay ? allTransactions.filter((tx) => tx.dayId === activeDay.id) : [];
  const carriedMachineBalances = machines.map((m) => {
    const prevOpening = activeDay?.machineOpeningBalances?.[m.id] ?? m.initialBalanceCents;
    const closing = calculateMachineClosingBalance(m.id, prevOpening, prevTxs);
    return {
      machine: m,
      closingBalanceCents: closing,
    };
  });

  const totalCarriedOrInitial = activeDay
    ? carriedMachineBalances.reduce((a, b) => safeAdd(a, b.closingBalanceCents), 0)
    : totalMachineInitial;

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    // Validate that previous day is closed
    if (activeDay && activeDay.status !== 'CLOSED') {
      setError('لا يمكن بدء يوم جديد لأن اليوم الحالي ما زال مفتوحاً. يجب إغلاق اليوم الحالي أولاً.');
      return;
    }

    const parsed = parseAmountToCents(openingInput);
    if (parsed.error || parsed.cents < 0) {
      setError(parsed.error || 'برجاء كتابة رصيد بداية صحيح');
      return;
    }

    if (parsed.cents < totalCarriedOrInitial) {
      setError(
        `لا يمكن أن يكون رصيد بداية اليوم أقل من إجمالي الأرصدة الموزعة على الماكينات (${formatEGP(totalCarriedOrInitial)}).`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      startNextDay(parsed.cents);
      setIsStartDayModalOpen(false);
      setActiveTab('home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء بدء اليوم');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="start-day-modal-backdrop"
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsStartDayModalOpen(false);
      }}
    >
      <div
        id="start-day-modal"
        className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in slide-in-from-bottom-6 duration-200"
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-700 text-white flex items-center justify-center shadow-xs">
              <Play className="w-4 h-4 fill-white ms-0.5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-stone-900 leading-tight">بدء دورة يوم جديد</h3>
              <p className="text-xs text-stone-500 mt-0.5">ترحيل الأرصدة وبدء دفتر اليومية</p>
            </div>
          </div>
          <button
            id="close-start-day-modal-btn"
            type="button"
            onClick={() => setIsStartDayModalOpen(false)}
            className="w-8 h-8 rounded-full bg-white border border-stone-200 text-stone-600 hover:bg-stone-100 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleStart} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {/* Active Day Warning if not closed */}
          {activeDay && activeDay.status === 'OPEN' && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-start gap-2 leading-relaxed">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div>اليوم الحالي ما زال مفتوحاً!</div>
                <div className="font-normal text-[11px] mt-0.5 text-rose-700">
                  بحسب القواعد المالية الدقيقة، يجب مطابقة وإغلاق اليوم الحالي قبل السماح ببدء يومية اليوم التالي.
                </div>
              </div>
            </div>
          )}

          {/* Transition Rule Banner */}
          <div className="p-3 rounded-xl bg-stone-100 border border-stone-200/80 text-stone-700 text-xs flex items-center justify-between">
            <div>
              <span className="text-stone-500 block text-[11px]">الرصيد الفعلي لختام اليوم السابق</span>
              <span className="font-bold text-stone-900 font-mono">{formatEGP(previousActualCounted)}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-stone-400 rotate-180" />
            <div className="text-left">
              <span className="text-stone-500 block text-[11px]">رصيد بداية اليوم الجديد</span>
              <span className="font-bold text-emerald-800 font-mono">{formatEGP(previousActualCounted)}</span>
            </div>
          </div>

          {/* Opening Balance Input */}
          <div>
            <label htmlFor="start-day-opening-input" className="text-xs font-bold text-stone-800 block mb-1.5">
              رصيد بداية اليوم الجديد (بالجنيه)
            </label>
            <div className="relative">
              <input
                id="start-day-opening-input"
                type="text"
                inputMode="decimal"
                value={openingInput}
                onChange={(e) => {
                  setOpeningInput(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
                className="w-full text-2xl font-black font-mono py-2.5 ps-4 pe-14 bg-stone-50 border-2 border-stone-300 rounded-xl focus:outline-none focus:border-stone-900 focus:bg-white text-stone-900"
                autoFocus
              />
              <span className="absolute end-4 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 font-mono">
                ج.م
              </span>
            </div>
            <p className="text-[11px] text-stone-500 mt-1">
              تم ضبطه تلقائياً ليعادل المبلغ الفعلي المعدود في ختام اليوم السابق.
            </p>
          </div>

          {/* Carried Forward Machine Balances */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Smartphone className="w-3.5 h-3.5 text-stone-500" />
              <span className="text-xs font-bold text-stone-700">الأرصدة الافتتاحية للمحفظات والماكينات لليوم الجديد</span>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto border border-stone-200 rounded-xl p-2 bg-stone-50/50">
              {carriedMachineBalances.map(({ machine, closingBalanceCents }) => (
                <div
                  key={machine.id}
                  className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-white border border-stone-200/60"
                >
                  <span className="font-medium text-stone-700">{machine.name}</span>
                  <span className="font-mono font-bold text-stone-900">{formatEGP(closingBalanceCents)}</span>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-stone-400 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>يتم ترحيل أرصدة الماكينات كأرصدة افتتاحية تلقائياً دون تكرار أو إنشاء حركات وهمية.</span>
            </div>
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex items-center gap-2">
            <button
              id="confirm-start-day-btn"
              type="submit"
              disabled={activeDay?.status === 'OPEN' || isSubmitting}
              className={`flex-1 py-3.5 px-4 font-bold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${
                activeDay?.status === 'OPEN' || isSubmitting
                  ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
              }`}
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{isSubmitting ? 'جاري بدء اليوم الجديد...' : 'بدء اليوم الجديد'}</span>
            </button>

            <button
              id="cancel-start-day-btn"
              type="button"
              disabled={isSubmitting}
              onClick={() => setIsStartDayModalOpen(false)}
              className="py-3.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
