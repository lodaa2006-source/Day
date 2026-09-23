import React, { useState } from 'react';
import { X, Play, ShieldCheck, AlertCircle, Smartphone, Info } from 'lucide-react';
import { useCash } from '../context/CashContext';
import { formatEGP, parseAmountToCents, safeAdd, safeSubtract } from '../utils/money';

export const StartDayModal: React.FC = () => {
  const {
    isStartDayModalOpen,
    setIsStartDayModalOpen,
    activeDay,
    machines,
    startNextDay,
    setActiveTab,
  } = useCash();

  // Active machines
  const activeMachines = machines.filter((m) => m.isActive);

  // Manual inputs - intentionally starts empty, NO auto-prefill from previous day
  const [openingInput, setOpeningInput] = useState<string>('');
  const [machineInputs, setMachineInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isStartDayModalOpen) return null;

  // Informational only: previous day's actual counted balance (never automatically applied)
  const previousActualCounted = activeDay?.actualClosingBalanceCents ?? null;

  // Real-time calculation of inputs
  const parsedBusiness = parseAmountToCents(openingInput || '0');
  const businessCents = parsedBusiness.cents >= 0 && !parsedBusiness.error ? parsedBusiness.cents : 0;

  // Parse machine inputs
  let totalAllocatedCents = 0;
  let hasInvalidMachineAmount = false;
  const machineOpeningsMap: Record<string, number> = {};

  for (const m of activeMachines) {
    const rawVal = machineInputs[m.id];
    if (rawVal !== undefined && rawVal.trim() !== '') {
      const parsedM = parseAmountToCents(rawVal);
      if (parsedM.error || parsedM.cents < 0) {
        hasInvalidMachineAmount = true;
      } else {
        machineOpeningsMap[m.id] = parsedM.cents;
        totalAllocatedCents = safeAdd(totalAllocatedCents, parsedM.cents);
      }
    } else {
      machineOpeningsMap[m.id] = 0;
    }
  }

  const remainingCashCents = safeSubtract(businessCents, totalAllocatedCents);
  const isAllocationOverBudget = totalAllocatedCents > businessCents;

  const handleMachineChange = (machineId: string, value: string) => {
    setMachineInputs((prev) => ({
      ...prev,
      [machineId]: value,
    }));
    setError(null);
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    // Validate that previous day is closed
    if (activeDay && activeDay.status !== 'CLOSED') {
      setError('لا يمكن بدء يوم جديد لأن اليوم الحالي ما زال مفتوحاً. يجب إغلاق اليوم الحالي أولاً.');
      return;
    }

    if (!openingInput.trim()) {
      setError('برجاء إدخال رصيد بداية اليوم يدوياً.');
      return;
    }

    const businessParsed = parseAmountToCents(openingInput);
    if (businessParsed.error || businessParsed.cents < 0) {
      setError(businessParsed.error || 'برجاء كتابة رصيد بداية صحيح.');
      return;
    }

    if (hasInvalidMachineAmount) {
      setError('يوجد مبلغ غير صحيح في خانات الماكينات.');
      return;
    }

    if (totalAllocatedCents > businessParsed.cents) {
      setError(
        `لا يمكن أن يتجاوز إجمالي المبالغ الموزعة على الماكينات (${formatEGP(totalAllocatedCents)}) رصيد بداية النشاط (${formatEGP(businessParsed.cents)}).`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      startNextDay(businessParsed.cents, machineOpeningsMap);
      setIsStartDayModalOpen(false);
      setOpeningInput('');
      setMachineInputs({});
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
              <p className="text-xs text-stone-500 mt-0.5">إدخال رصيد البداية وتوزيع العهدة يدوياً</p>
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
                  بحسب القواعد المالية، يجب مطابقة وإغلاق اليوم الحالي قبل السماح ببدء يومية اليوم التالي.
                </div>
              </div>
            </div>
          )}

          {/* Informational previous day balance - Strictly non-binding */}
          {previousActualCounted !== null && (
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-stone-700 text-xs flex items-start gap-2">
              <Info className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-semibold block">معلومات استرشادية لليوم السابق:</span>
                <span className="text-[11px] text-stone-600">
                  الرصيد الفعلي لختام اليوم السابق كان <strong>{formatEGP(previousActualCounted)}</strong>. لا يتم ترحيل أي مبالغ تلقائياً؛ يجب إدخال رصيد اليوم وتوزيع الماكينات يدوياً أدناه.
                </span>
              </div>
            </div>
          )}

          {/* Opening Business Balance Input */}
          <div>
            <label htmlFor="start-day-opening-input" className="text-xs font-bold text-stone-800 block mb-1.5">
              رصيد بداية اليوم الجديد (إجمالي النقدية للنشاط) <span className="text-rose-600">*</span>
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
              أدخل المبلغ الإجمالي الذي يبدأ به النشاط اليوم (الدرج + عهد الماكينات).
            </p>
          </div>

          {/* Machine Openings Inputs */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Smartphone className="w-3.5 h-3.5 text-stone-500" />
              <span className="text-xs font-bold text-stone-700">توزيع العهدة الافتتاحية على الماكينات والحسابات</span>
            </div>
            <div className="space-y-2 border border-stone-200 rounded-xl p-3 bg-stone-50/50">
              {activeMachines.map((machine) => (
                <div
                  key={machine.id}
                  className="flex items-center justify-between gap-3 text-xs py-1 px-2 rounded-lg bg-white border border-stone-200/80"
                >
                  <label htmlFor={`start-day-machine-${machine.id}`} className="font-semibold text-stone-700 shrink-0">
                    {machine.name}
                  </label>
                  <div className="relative w-32">
                    <input
                      id={`start-day-machine-${machine.id}`}
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={machineInputs[machine.id] ?? ''}
                      onChange={(e) => handleMachineChange(machine.id, e.target.value)}
                      className="w-full text-xs font-mono font-bold py-1.5 ps-2 pe-8 bg-stone-50 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:border-stone-900 text-end"
                    />
                    <span className="absolute end-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-stone-400 font-mono">
                      ج.م
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Allocation Breakdown Bar */}
          <div className="p-3 rounded-xl bg-stone-100 border border-stone-200 space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-stone-600">
              <span>إجمالي رصيد بداية النشاط:</span>
              <span className="font-mono font-bold text-stone-900">{formatEGP(businessCents)}</span>
            </div>
            <div className="flex items-center justify-between text-stone-600">
              <span>إجمالي الموزع على الماكينات:</span>
              <span className="font-mono font-bold text-stone-900">{formatEGP(totalAllocatedCents)}</span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-stone-200">
              <span className="font-semibold text-stone-700">النقدية غير الموزعة (درج الكاش):</span>
              <span
                className={`font-mono font-black ${
                  isAllocationOverBudget ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {formatEGP(remainingCashCents)}
              </span>
            </div>
            {isAllocationOverBudget && (
              <div className="text-[11px] font-bold text-rose-600 mt-1 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>المبالغ الموزعة على الماكينات تتجاوز إجمالي رصيد بداية اليوم!</span>
              </div>
            )}
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
              disabled={activeDay?.status === 'OPEN' || isSubmitting || isAllocationOverBudget}
              className={`flex-1 py-3.5 px-4 font-bold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${
                activeDay?.status === 'OPEN' || isSubmitting || isAllocationOverBudget
                  ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
              }`}
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{isSubmitting ? 'جاري بدء اليوم الجديد...' : 'تأكيد وبدء اليوم الجديد'}</span>
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
