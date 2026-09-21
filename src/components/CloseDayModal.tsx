import React, { useState, useEffect } from 'react';
import { X, Lock, AlertTriangle, CheckCircle2, TrendingDown, TrendingUp, Info } from 'lucide-react';
import { useCash } from '../context/CashContext';
import { formatEGP, parseAmountToCents, fromCents } from '../utils/money';

export const CloseDayModal: React.FC = () => {
  const {
    isCloseDayModalOpen,
    setIsCloseDayModalOpen,
    activeDay,
    dailySummary,
    actualCountedCents,
    setActualCounted,
    closeDay,
  } = useCash();

  const [inputVal, setInputVal] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Synchronize input with current actualCountedCents
  useEffect(() => {
    if (actualCountedCents !== null) {
      setInputVal(String(fromCents(actualCountedCents)));
    } else {
      setInputVal('');
    }
  }, [actualCountedCents, isCloseDayModalOpen]);

  if (!isCloseDayModalOpen || !activeDay) return null;

  // Calculate live preview difference
  const parsed = parseAmountToCents(inputVal);
  const currentCountedCents = !parsed.error && parsed.cents >= 0 ? parsed.cents : null;
  const differenceCents = currentCountedCents !== null ? currentCountedCents - dailySummary.expectedBalanceCents : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    if (currentCountedCents === null) {
      setError('يجب إدخال المبلغ الفعلي المعدود في درج الكاش والماكينات قبل إغلاق اليوم.');
      return;
    }

    setIsSubmitting(true);
    try {
      setActualCounted(currentCountedCents);
      closeDay(currentCountedCents, notes);
      setIsCloseDayModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء إغلاق اليوم');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="close-day-modal-backdrop"
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsCloseDayModalOpen(false);
      }}
    >
      <div
        id="close-day-modal"
        className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in slide-in-from-bottom-6 duration-200"
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-stone-900 text-amber-400 flex items-center justify-center shadow-xs">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-stone-900 leading-tight">إغلاق يومية النقدية</h3>
              <p className="text-xs text-stone-500 mt-0.5">مطابقة النقدية وختام الحسابات لليوم</p>
            </div>
          </div>
          <button
            id="close-close-day-modal-btn"
            type="button"
            onClick={() => setIsCloseDayModalOpen(false)}
            className="w-8 h-8 rounded-full bg-white border border-stone-200 text-stone-600 hover:bg-stone-100 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {/* Day Financial Breakdown Table */}
          <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200/80 space-y-2.5 text-xs font-medium">
            <div className="flex justify-between items-center pb-2 border-b border-stone-200">
              <span className="text-stone-600">رصيد بداية اليوم</span>
              <span className="font-mono font-bold text-stone-900">{formatEGP(dailySummary.openingBalanceCents)}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-emerald-700 font-semibold">+ إجمالي الدخل الحقيقي</span>
              <span className="font-mono font-bold text-emerald-700">+{formatEGP(dailySummary.totalIncomeCents)}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-rose-700 font-semibold">- إجمالي المصروف الحقيقي</span>
              <span className="font-mono font-bold text-rose-700">-{formatEGP(dailySummary.totalExpenseCents)}</span>
            </div>

            <div className="flex justify-between items-center text-[11px] text-stone-400">
              <span>التحويلات الداخلية (لا تؤثر على الإجمالي)</span>
              <span className="font-mono">{formatEGP(dailySummary.totalTransfersCents)}</span>
            </div>

            <div className="flex justify-between items-center pt-2.5 border-t-2 border-stone-300 text-sm">
              <span className="font-bold text-stone-900">الرصيد الدفتري المتوقع</span>
              <span className="font-mono font-black text-stone-900 text-base">
                {formatEGP(dailySummary.expectedBalanceCents)}
              </span>
            </div>
          </div>

          {/* Actual Counted Input */}
          <div>
            <label htmlFor="close-day-counted-input" className="text-xs font-bold text-stone-800 block mb-1.5">
              المبلغ الفعلي الموجود (درج الكاش + الماكينات بعد العد)
            </label>
            <div className="relative">
              <input
                id="close-day-counted-input"
                type="text"
                inputMode="decimal"
                value={inputVal}
                onChange={(e) => {
                  setInputVal(e.target.value);
                  setError(null);
                }}
                placeholder="اكتب المبلغ الفعلي المعدود..."
                className="w-full text-2xl font-black font-mono py-2.5 ps-4 pe-14 bg-stone-50 border-2 border-stone-300 rounded-xl focus:outline-none focus:border-stone-900 focus:bg-white text-stone-900"
                autoFocus
              />
              <span className="absolute end-4 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 font-mono">
                ج.م
              </span>
            </div>
            <p className="text-[11px] text-stone-500 mt-1">
              هذا المبلغ الفعلي هو الذي سيعتمد كرصيد بداية لليوم التالي.
            </p>
          </div>

          {/* Live Difference Evaluation Banner */}
          {differenceCents !== null && (
            <div
              id="close-day-difference-card"
              className={`p-3.5 rounded-xl border flex items-center justify-between ${
                differenceCents === 0
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : differenceCents < 0
                  ? 'bg-rose-50 border-rose-300 text-rose-900'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-2">
                {differenceCents === 0 && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
                {differenceCents < 0 && <TrendingDown className="w-5 h-5 text-rose-600 shrink-0" />}
                {differenceCents > 0 && <TrendingUp className="w-5 h-5 text-amber-600 shrink-0" />}
                <div>
                  <div className="text-xs font-bold">
                    {differenceCents === 0 ? 'اليوم متطابق تماماً' : differenceCents < 0 ? 'يوجد عجز' : 'توجد زيادة'}
                  </div>
                  <div className="text-[11px] opacity-80">
                    {differenceCents === 0
                      ? 'الفعلي يطابق الدفتري المتوقع بالقرش'
                      : differenceCents < 0
                      ? 'المبلغ الفعلي أقل من المتوقع'
                      : 'المبلغ الفعلي أكثر من المتوقع'}
                  </div>
                </div>
              </div>
              <div className="font-mono font-black text-sm text-left">
                {differenceCents > 0 ? `+${formatEGP(differenceCents)}` : formatEGP(differenceCents)}
              </div>
            </div>
          )}

          {/* Optional Notes */}
          <div>
            <label htmlFor="close-day-notes" className="text-xs font-bold text-stone-700 block mb-1.5">
              ملاحظات ختام اليوم (اختياري)
            </label>
            <input
              id="close-day-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: سبب العجز/الزيادة، ملاحظات لليوم التالي..."
              className="w-full text-xs font-medium p-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-stone-900"
            />
          </div>

          {/* Financial Integrity Note */}
          <div className="p-3 rounded-xl bg-stone-100 border border-stone-200 text-stone-600 text-[11px] flex items-start gap-2 leading-relaxed">
            <Info className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" />
            <span>
              <strong>قاعدة النزاهة المالية:</strong> لا يشترط أن يكون الفرق صفراً للإغلاق. سيتم تثبيت العجز أو الزيادة بأمان، وسيبدأ اليوم التالي برصيد النقدية الفعلي المحسوب بدقة.
            </span>
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex items-center gap-2">
            <button
              id="confirm-close-day-btn"
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3.5 px-4 bg-stone-900 hover:bg-black text-white font-bold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Lock className="w-4 h-4" />
              <span>{isSubmitting ? 'جاري تأكيد الإغلاق...' : 'تأكيد إغلاق اليومية'}</span>
            </button>

            <button
              id="cancel-close-day-btn"
              type="button"
              disabled={isSubmitting}
              onClick={() => setIsCloseDayModalOpen(false)}
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
