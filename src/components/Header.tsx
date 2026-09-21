import React from 'react';
import { BookOpen, Calendar, Lock, Unlock } from 'lucide-react';
import { formatArabicDate } from '../utils/calculations';
import { useCash } from '../context/CashContext';

export const Header: React.FC = () => {
  const { currentDay, isCurrentDayClosed } = useCash();
  const todayArabic = formatArabicDate();

  return (
    <header id="app-header" className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-stone-200">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Brand & Purpose */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-stone-900 text-amber-400 flex items-center justify-center shadow-sm">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-stone-900 leading-tight">يومية النقدية</h1>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 ${
                  !currentDay
                    ? 'bg-stone-100 text-stone-500'
                    : isCurrentDayClosed
                    ? 'bg-stone-100 text-stone-600'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {!currentDay ? (
                  <span>غير مهيأ</span>
                ) : isCurrentDayClosed ? (
                  <>
                    <Lock className="w-2.5 h-2.5" />
                    <span>مغلق</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-2.5 h-2.5" />
                    <span>مفتوح</span>
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-stone-500 font-medium mt-0.5">
              <Calendar className="w-3.5 h-3.5 text-stone-400" />
              <span>{currentDay ? `يوم ${currentDay.date}` : todayArabic}</span>
            </div>
          </div>
        </div>

        {/* Clean System Status */}
        <div className="text-xs text-stone-400 font-mono">
          {!currentDay ? 'حالة الصفر' : isCurrentDayClosed ? 'يوم مقفل' : 'يوم جاري'}
        </div>
      </div>
    </header>
  );
};
