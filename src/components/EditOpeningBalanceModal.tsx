import React, { useState } from 'react';
import { X, Check, AlertCircle, Coins } from 'lucide-react';
import { useCash } from '../context/CashContext';
import { parseAmountToCents, fromCents, formatEGP } from '../utils/money';

export const EditOpeningBalanceModal: React.FC = () => {
  const {
    isEditOpeningBalanceOpen,
    setIsEditOpeningBalanceOpen,
    openingBalanceCents,
    setOpeningBalance,
    transactions,
    currentDay,
    isCurrentDayClosed,
    dailySummary,
  } = useCash();

  const [inputVal, setInputVal] = useState<string>(() =>
    String(fromCents(openingBalanceCents))
  );
  const [error, setError] = useState<string | null>(null);

  if (!isEditOpeningBalanceOpen) return null;

  const allocatedCents = dailySummary.allocatedOpeningCents ?? 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isCurrentDayClosed) {
      setError('لا يمكن تعديل رصيد البداية ليوم مغلق. يجب إعادة فتح اليوم أولاً.');
      return;
    }

    if (!inputVal.trim()) {
      setError('برجاء كتابة رصيد بداية اليوم');
      return;
    }

    const parsed = parseAmountToCents(inputVal);
    if (parsed.error && parsed.cents < 0) {
      setError(parsed.error);
      return;
    }

    if (parsed.cents < allocatedCents) {
      setError(
        `لا يمكن أن يكون رصيد بداية اليوم أقل من إجمالي المبالغ الموزعة على الماكينات (${formatEGP(allocatedCents)}).`
      );
      return;
    }

    try {
      setOpeningBalance(parsed.cents);
      setError(null);
      setIsEditOpeningBalanceOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تعديل رصيد البداية');
    }
  };

  return (
    <div
      id="edit-opening-balance-backdrop"
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsEditOpeningBalanceOpen(false);
      }}
    >
      <div
        id="edit-opening-balance-modal"
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 overflow-hidden"
      >
        <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-100 text-stone-700 flex items-center justify-center">
              <Coins className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900 leading-tight">تعديل رصيد بداية اليوم</h3>
              <p className="text-[11px] text-stone-500">النقدية الافتتاحية التي بدأ بها المحل اليوم</p>
            </div>
          </div>
          <button
            id="close-edit-opening-btn"
            type="button"
            onClick={() => setIsEditOpeningBalanceOpen(false)}
            className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          {isCurrentDayClosed && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>اليوم مغلق حالياً. لتعديل رصيد البداية أو الحركات، يجب إعادة فتح اليوم أولاً.</span>
            </div>
          )}

          {!isCurrentDayClosed && transactions.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>تنبيه مالي:</strong> تم تسجيل {transactions.length} حركات في هذا اليوم بالفعل. تعديل رصيد البداية سيعيد احتساب الرصيد المتوقع للنشاط ومطابقة العجز/الزيادة فوراً.
              </span>
            </div>
          )}

          <div>
            <label htmlFor="opening-balance-input" className="text-xs font-bold text-stone-700 block mb-1.5">
              رصيد بداية اليوم (درج الكاش والماكينات)
            </label>
            <div className="relative">
              <input
                id="opening-balance-input"
                type="text"
                disabled={isCurrentDayClosed}
                inputMode="decimal"
                value={inputVal}
                onChange={(e) => {
                  setInputVal(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
                className={`w-full text-2xl font-black font-mono py-2.5 ps-4 pe-14 border-2 rounded-xl text-stone-900 ${
                  isCurrentDayClosed
                    ? 'bg-stone-100 border-stone-200 cursor-not-allowed opacity-75'
                    : 'bg-stone-50 border-stone-200 focus:outline-none focus:border-stone-900 focus:bg-white'
                }`}
                autoFocus={!isCurrentDayClosed}
              />
              <span className="absolute end-4 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 font-mono">
                ج.م
              </span>
            </div>
            <p className="text-[11px] text-stone-400 mt-1">
              سيتم إعادة حساب الرصيد المتوقع لليوم تلقائياً بناءً على هذا الرقم والحركات المسجلة.
            </p>
            {allocatedCents > 0 && (
              <div className="mt-2 p-2.5 rounded-xl bg-stone-100 border border-stone-200 text-stone-700 text-xs flex items-center justify-between">
                <span className="font-medium">المبالغ الموزعة بالفعل على الماكينات:</span>
                <span className="font-mono font-bold text-stone-900">{formatEGP(allocatedCents)}</span>
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
              id="save-opening-balance-btn"
              type="submit"
              disabled={isCurrentDayClosed}
              className={`flex-1 py-3 px-4 font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 ${
                isCurrentDayClosed
                  ? 'bg-stone-300 text-stone-500 cursor-not-allowed'
                  : 'bg-stone-900 hover:bg-black text-white cursor-pointer'
              }`}
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>تحديث رصيد البداية</span>
            </button>

            <button
              id="cancel-opening-balance-btn"
              type="button"
              onClick={() => setIsEditOpeningBalanceOpen(false)}
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
