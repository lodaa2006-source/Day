import React, { useState } from 'react';
import {
  Calendar,
  Lock,
  Unlock,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Eye,
  ArrowLeft,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { useCash } from '../context/CashContext';
import { formatEGP } from '../utils/money';
import { calculateDaySummary, calculateReconciliation } from '../utils/calculations';
import { Day } from '../types';

export const HistoryView: React.FC = () => {
  const {
    days,
    activeDay,
    viewingDayId,
    setViewingDayId,
    allTransactions,
    reopenDay,
    setActiveTab,
    setIsStartDayModalOpen,
  } = useCash();

  const [reopenTargetDay, setReopenTargetDay] = useState<Day | null>(null);

  // Sort days newest first
  const sortedDays = [...days].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div id="history-view" className="space-y-4 pb-12">
      {/* Header & Active Day Info */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-stone-900 leading-tight">سجل الأيام السابقة</h2>
          <p className="text-xs text-stone-500 mt-0.5">أرشيف اليوميات المالية ومطابقات الإغلاق</p>
        </div>

        {activeDay?.status === 'CLOSED' ? (
          <button
            id="history-start-day-btn"
            type="button"
            onClick={() => setIsStartDayModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all shadow-xs"
          >
            <span>بدء يوم جديد</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-emerald-800 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
            <span>اليوم الحالي مفتوح ({activeDay?.date})</span>
          </div>
        )}
      </div>

      {/* Currently Viewing Historical Notice */}
      {viewingDayId && viewingDayId !== activeDay?.id && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-700 shrink-0" />
            <span className="font-semibold">أنت تستعرض حالياً سجل يوم سابق (للقراءة والتدقيق فقط).</span>
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

      {/* Days List */}
      <div className="space-y-3">
        {sortedDays.map((day) => {
          const dayTxs = allTransactions.filter((tx) => tx.dayId === day.id);
          const summary = calculateDaySummary(day, dayTxs);
          const rec = calculateReconciliation(summary.expectedBalanceCents, day.actualClosingBalanceCents);
          const isCurrentlyActive = day.id === activeDay?.id;
          const isCurrentlyViewing = day.id === (viewingDayId || activeDay?.id);

          return (
            <div
              key={day.id}
              id={`history-day-card-${day.id}`}
              className={`rounded-2xl border bg-white p-4 sm:p-5 transition-all shadow-xs ${
                isCurrentlyViewing
                  ? 'border-stone-900 ring-2 ring-stone-900/10'
                  : 'border-stone-200 hover:border-stone-300'
              }`}
            >
              {/* Top Row: Date & Badges */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-stone-100">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold ${
                      day.status === 'OPEN'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-stone-100 text-stone-700'
                    }`}
                  >
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-stone-900 text-sm sm:text-base font-mono">
                        {day.date}
                      </span>
                      {isCurrentlyActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                          اليوم الحالي
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-stone-400 mt-0.5">
                      {dayTxs.length} حركات مسجلة
                    </div>
                  </div>
                </div>

                {/* Status & Reconciliation Badges */}
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-bold ${
                      day.status === 'OPEN'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-stone-100 text-stone-700'
                    }`}
                  >
                    {day.status === 'OPEN' ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    <span>{day.status === 'OPEN' ? 'مفتوح' : 'مغلق'}</span>
                  </span>

                  {day.actualClosingBalanceCents !== null && (
                    <span
                      className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-bold font-mono ${
                        rec.isMatched
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : (rec.differenceCents || 0) < 0
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {rec.isMatched ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          <span>متطابق</span>
                        </>
                      ) : (rec.differenceCents ?? 0) < 0 ? (
                        <>
                          <TrendingDown className="w-3 h-3" />
                          <span>عجز {formatEGP(rec.differenceCents ?? 0)}</span>
                        </>
                      ) : (
                        <>
                          <TrendingUp className="w-3 h-3" />
                          <span>زيادة +{formatEGP(rec.differenceCents ?? 0)}</span>
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>

              {/* Financial Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 text-xs">
                <div className="p-2.5 bg-stone-50 rounded-xl">
                  <span className="text-stone-500 block text-[11px] mb-0.5">رصيد البداية</span>
                  <span className="font-mono font-bold text-stone-900">
                    {formatEGP(day.openingBusinessBalanceCents)}
                  </span>
                </div>

                <div className="p-2.5 bg-emerald-50/60 rounded-xl">
                  <span className="text-emerald-800 block text-[11px] mb-0.5">إجمالي الداخل (+)</span>
                  <span className="font-mono font-bold text-emerald-800">
                    +{formatEGP(summary.totalIncomeCents)}
                  </span>
                </div>

                <div className="p-2.5 bg-rose-50/60 rounded-xl">
                  <span className="text-rose-800 block text-[11px] mb-0.5">إجمالي الخارج (-)</span>
                  <span className="font-mono font-bold text-rose-800">
                    -{formatEGP(summary.totalExpenseCents)}
                  </span>
                </div>

                <div className="p-2.5 bg-stone-100/70 rounded-xl">
                  <span className="text-stone-700 block text-[11px] mb-0.5">المعدود الفعلي</span>
                  <span className="font-mono font-black text-stone-900">
                    {day.actualClosingBalanceCents !== null
                      ? formatEGP(day.actualClosingBalanceCents)
                      : 'بانتظار الإغلاق'}
                  </span>
                </div>
              </div>

              {/* Actions for this day */}
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-stone-100 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setViewingDayId(day.id);
                    setActiveTab('transactions');
                  }}
                  className="flex items-center gap-1.5 font-bold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>عرض حركات اليوم ({dayTxs.length})</span>
                </button>

                {day.status === 'CLOSED' && (
                  <button
                    type="button"
                    onClick={() => setReopenTargetDay(day)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-stone-500 hover:text-amber-700 transition-colors"
                  >
                    <Unlock className="w-3 h-3" />
                    <span>إعادة فتح اليوم للتعديل</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reopen Warning Modal */}
      {reopenTargetDay && (
        <div
          id="reopen-day-backdrop"
          className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white rounded-2xl p-5 shadow-2xl border border-stone-200 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center gap-2.5 text-amber-700">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-stone-900">تأكيد إعادة فتح اليوم</h3>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              أنت على وشك إعادة فتح يومية تاريخ <strong>{reopenTargetDay.date}</strong>.
              إعادة الفتح تسمح بإضافة وتعديل وحذف الحركات لهذا اليوم، وسيتطلب ذلك إعادة مطابقته وإغلاقه لاحقاً لضمان تسلسل الأرصدة.
            </p>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  reopenDay(reopenTargetDay.id);
                  setReopenTargetDay(null);
                  setActiveTab('home');
                }}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                تأكيد إعادة الفتح
              </button>
              <button
                type="button"
                onClick={() => setReopenTargetDay(null)}
                className="py-2.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
