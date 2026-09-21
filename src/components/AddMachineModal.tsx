import React, { useState } from 'react';
import { X, Smartphone, Check, AlertCircle, Info } from 'lucide-react';
import { useCash } from '../context/CashContext';
import { parseAmountToCents, formatEGP } from '../utils/money';

export const AddMachineModal: React.FC = () => {
  const { isAddMachineOpen, setIsAddMachineOpen, addMachine, currentDay, dailySummary } = useCash();
  const [name, setName] = useState('');
  const [initialBalanceInput, setInitialBalanceInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isAddMachineOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('برجاء كتابة اسم الماكينة أو الحساب');
      return;
    }

    let initialCents = 0;
    if (initialBalanceInput.trim()) {
      const parsed = parseAmountToCents(initialBalanceInput);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }
      initialCents = parsed.cents;
    }

    if (
      currentDay &&
      currentDay.status === 'OPEN' &&
      currentDay.openingBusinessBalanceCents > 0 &&
      initialCents > dailySummary.unallocatedOpeningCents
    ) {
      setError('المبلغ المطلوب توزيعه أكبر من المبلغ المتبقي من افتتاح اليوم.');
      return;
    }

    try {
      addMachine(name.trim(), initialCents);
      setName('');
      setInitialBalanceInput('');
      setError(null);
      setIsAddMachineOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء إضافة الماكينة');
    }
  };

  const isDayOpenWithBalance = currentDay && currentDay.status === 'OPEN' && currentDay.openingBusinessBalanceCents > 0;

  return (
    <div
      id="add-machine-modal-backdrop"
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsAddMachineOpen(false);
      }}
    >
      <div
        id="add-machine-modal"
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 overflow-hidden"
      >
        <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-100 text-stone-700 flex items-center justify-center">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900 leading-tight">إضافة ماكينة أو حساب جديد</h3>
              <p className="text-[11px] text-stone-500">حساب مخصص لتوزيع وتتبع أرصدة اليومية</p>
            </div>
          </div>
          <button
            id="close-machine-modal-btn"
            type="button"
            onClick={() => setIsAddMachineOpen(false)}
            className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          <div>
            <label htmlFor="machine-name-input" className="text-xs font-bold text-stone-700 block mb-1.5">
              اسم الماكينة أو الحساب
            </label>
            <input
              id="machine-name-input"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="مثال: ماكينة أمان، محفظة إلكترونية، خزينة فرعية..."
              className="w-full text-sm font-semibold p-2.5 bg-stone-50 border-2 border-stone-200 rounded-xl focus:outline-none focus:border-stone-900 focus:bg-white"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="machine-initial-balance-input" className="text-xs font-bold text-stone-700 block mb-1.5">
              رصيد البداية في الماكينة (اختياري)
            </label>
            <div className="relative">
              <input
                id="machine-initial-balance-input"
                type="text"
                inputMode="decimal"
                value={initialBalanceInput}
                onChange={(e) => {
                  setInitialBalanceInput(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
                className="w-full text-lg font-bold font-mono py-2.5 ps-3 pe-12 bg-stone-50 border-2 border-stone-200 rounded-xl focus:outline-none focus:border-stone-900 focus:bg-white"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 font-mono">
                ج.م
              </span>
            </div>
            <p className="text-[11px] text-stone-400 mt-1">
              الرصيد الموجود في الماكينة في أول اليوم (يقتطع من افتتاح اليوم دون تغيير إجمالي الفلوس)
            </p>
            {isDayOpenWithBalance && (
              <div className="mt-2 p-2 rounded-lg bg-stone-100 border border-stone-200 text-stone-700 text-xs flex items-center justify-between">
                <span className="font-medium">المتبقي غير الموزع من افتتاح اليوم:</span>
                <span className="font-mono font-bold text-stone-900">{formatEGP(dailySummary.unallocatedOpeningCents)}</span>
              </div>
            )}
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2 flex items-center gap-2">
            <button
              id="save-machine-btn"
              type="submit"
              className="flex-1 py-3 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>حفظ وإضافة الماكينة</span>
            </button>

            <button
              id="cancel-machine-btn"
              type="button"
              onClick={() => setIsAddMachineOpen(false)}
              className="py-3 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
