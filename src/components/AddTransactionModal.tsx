import React, { useState } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Check, AlertCircle, Info, ShieldAlert } from 'lucide-react';
import { useCash } from '../context/CashContext';
import {
  TransactionKind,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_TRANSFER_CATEGORY,
} from '../types';
import { parseAmountToCents, formatCurrency } from '../utils/money';

export const AddTransactionModal: React.FC = () => {
  const {
    isAddTransactionOpen,
    setIsAddTransactionOpen,
    addTransaction,
    machines,
    machineBalances,
    setIsAddMachineOpen,
  } = useCash();

  // Form State
  const [kind, setKind] = useState<TransactionKind>('INCOME');
  const [category, setCategory] = useState<string>(DEFAULT_INCOME_CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState<string>('');
  const [isCustomCategory, setIsCustomCategory] = useState<boolean>(false);
  const [amountInput, setAmountInput] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Source & Destination machines
  const [sourceMachineId, setSourceMachineId] = useState<string>(
    machines.length > 0 ? machines[0].id : ''
  );
  const [destinationMachineId, setDestinationMachineId] = useState<string>(
    machines.length > 1 ? machines[1].id : machines.length > 0 ? machines[0].id : ''
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isAddTransactionOpen) return null;

  // Selected source machine balance
  const sourceBalance = sourceMachineId ? (machineBalances[sourceMachineId] ?? 0) : 0;
  const parsed = parseAmountToCents(amountInput);
  const isInsufficientFunds =
    (kind === 'EXPENSE' || kind === 'TRANSFER') &&
    !parsed.error &&
    parsed.cents > 0 &&
    sourceMachineId &&
    parsed.cents > sourceBalance;

  // Handle kind change and category defaults
  const handleKindChange = (newKind: TransactionKind) => {
    setKind(newKind);
    setIsCustomCategory(false);
    setCustomCategory('');
    setErrorMessage(null);

    if (newKind === 'INCOME') {
      setCategory(DEFAULT_INCOME_CATEGORIES[0]);
    } else if (newKind === 'EXPENSE') {
      setCategory(DEFAULT_EXPENSE_CATEGORIES[0]);
    } else {
      setCategory(DEFAULT_TRANSFER_CATEGORY);
      // Ensure different machines if possible
      if (machines.length >= 2 && sourceMachineId === destinationMachineId) {
        const other = machines.find((m) => m.id !== sourceMachineId);
        if (other) setDestinationMachineId(other.id);
      }
    }
  };

  const categories = kind === 'INCOME' ? DEFAULT_INCOME_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMessage(null);

    // 1. Validate amount
    const parsedAmount = parseAmountToCents(amountInput);
    if (parsedAmount.error || parsedAmount.cents <= 0) {
      setErrorMessage(parsedAmount.error || 'برجاء كتابة مبلغ صحيح أكبر من صفر');
      return;
    }

    // 2. Determine category
    let finalCategory = category;
    if (kind === 'TRANSFER') {
      finalCategory = DEFAULT_TRANSFER_CATEGORY;
    } else if (isCustomCategory) {
      finalCategory = customCategory.trim() || (kind === 'INCOME' ? 'دخل آخر' : 'مصروف آخر');
    }

    // 3. Validate accounts based on kind
    if (kind === 'TRANSFER') {
      if (!sourceMachineId) {
        setErrorMessage('يجب اختيار الماكينة المحول منها');
        return;
      }
      if (!destinationMachineId) {
        setErrorMessage('يجب اختيار الماكينة المحول إليها');
        return;
      }
      if (sourceMachineId === destinationMachineId) {
        setErrorMessage('لا يمكن التحويل من وإلى نفس الماكينة / الحساب');
        return;
      }
    } else if (kind === 'EXPENSE') {
      if (!sourceMachineId) {
        setErrorMessage('يجب تحديد ماكينة أو حساب المصدر للخصم منه');
        return;
      }
    } else if (kind === 'INCOME') {
      if (!destinationMachineId) {
        setErrorMessage('يجب تحديد ماكينة أو حساب استلام النقدية');
        return;
      }
    }

    // 4. Overdraft check
    if ((kind === 'EXPENSE' || kind === 'TRANSFER') && parsedAmount.cents > sourceBalance) {
      const srcName = machines.find((m) => m.id === sourceMachineId)?.name || 'الماكينة المصدر';
      setErrorMessage(`رصيد (${srcName}) غير كافٍ: المتاح ${formatCurrency(sourceBalance)} والمطلوب ${formatCurrency(parsedAmount.cents)}`);
      return;
    }

    setIsSubmitting(true);
    try {
      addTransaction({
        transactionKind: kind,
        category: finalCategory,
        amountCents: parsedAmount.cents,
        description: description.trim(),
        sourceMachineAccountId: kind === 'INCOME' ? undefined : (sourceMachineId || undefined),
        destinationMachineAccountId: kind === 'EXPENSE' ? undefined : (destinationMachineId || undefined),
      });

      // Reset & Close
      setAmountInput('');
      setDescription('');
      setErrorMessage(null);
      setIsAddTransactionOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل الحركة');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="add-transaction-modal-backdrop"
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsAddTransactionOpen(false);
      }}
    >
      <div
        id="add-transaction-modal"
        className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in slide-in-from-bottom-6 duration-200"
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-stone-900 leading-tight">تسجيل حركة جديدة</h3>
            <p className="text-xs text-stone-500 mt-0.5">تسجيل فوري في يومية النقدية لليوم</p>
          </div>
          <button
            id="close-tx-modal-btn"
            type="button"
            onClick={() => setIsAddTransactionOpen(false)}
            className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body / Form */}
        {machines.length === 0 ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-bold text-stone-900">لا توجد ماكينات أو حسابات مضافة</h4>
              <p className="text-xs text-stone-500 mt-1.5 max-w-xs mx-auto leading-relaxed">
                لتسجيل الحركات المالية، يجب أولاً إضافة ماكينة أو حساب واحد على الأقل (مثل درج النقدية أو ماكينة دفع) لتحديد مصدر أو وجهة الأموال بدقة.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                id="add-machine-from-tx-modal-btn"
                type="button"
                onClick={() => {
                  setIsAddTransactionOpen(false);
                  setIsAddMachineOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <span>+ إضافة ماكينة / حساب الآن</span>
              </button>
              <button
                type="button"
                onClick={() => setIsAddTransactionOpen(false)}
                className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {/* Step 1: نوع العملية (دخل / خرج / تحويل) */}
          <div>
            <label className="text-xs font-bold text-stone-700 block mb-1.5">
              1. نوع العملية
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                id="tx-type-income-btn"
                type="button"
                onClick={() => handleKindChange('INCOME')}
                className={`py-2.5 px-2 rounded-xl font-bold text-xs sm:text-sm flex flex-col sm:flex-row items-center justify-center gap-1.5 border-2 transition-all cursor-pointer ${
                  kind === 'INCOME'
                    ? 'bg-emerald-700 border-emerald-700 text-white shadow-sm'
                    : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-emerald-50/50'
                }`}
              >
                <ArrowDownLeft className="w-4 h-4 stroke-[3] shrink-0" />
                <span>دخل (إيراد +)</span>
              </button>

              <button
                id="tx-type-expense-btn"
                type="button"
                onClick={() => handleKindChange('EXPENSE')}
                className={`py-2.5 px-2 rounded-xl font-bold text-xs sm:text-sm flex flex-col sm:flex-row items-center justify-center gap-1.5 border-2 transition-all cursor-pointer ${
                  kind === 'EXPENSE'
                    ? 'bg-rose-700 border-rose-700 text-white shadow-sm'
                    : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-rose-50/50'
                }`}
              >
                <ArrowUpRight className="w-4 h-4 stroke-[3] shrink-0" />
                <span>خرج (مصروف -)</span>
              </button>

              <button
                id="tx-type-transfer-btn"
                type="button"
                onClick={() => handleKindChange('TRANSFER')}
                className={`py-2.5 px-2 rounded-xl font-bold text-xs sm:text-sm flex flex-col sm:flex-row items-center justify-center gap-1.5 border-2 transition-all cursor-pointer ${
                  kind === 'TRANSFER'
                    ? 'bg-amber-600 border-amber-600 text-white shadow-sm'
                    : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-amber-50/50'
                }`}
              >
                <ArrowLeftRight className="w-4 h-4 stroke-[3] shrink-0" />
                <span>تحويل بين الماكينات</span>
              </button>
            </div>
          </div>

          {/* Transfer Helper Banner */}
          {kind === 'TRANSFER' && (
            <div
              id="transfer-helper-text"
              className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs font-semibold flex items-start gap-2 leading-relaxed"
            >
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>التحويل ينقل الفلوس بين الماكينات فقط ولا يغيّر إجمالي فلوس النشاط.</span>
            </div>
          )}

          {/* Step 2: التصنيف (للإيرادات والمصروفات فقط) */}
          {kind !== 'TRANSFER' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-stone-700">2. التصنيف</label>
                <button
                  type="button"
                  onClick={() => setIsCustomCategory(!isCustomCategory)}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  {isCustomCategory ? 'اختيار من القائمة' : '+ تصنيف مخصص'}
                </button>
              </div>

              {isCustomCategory ? (
                <input
                  id="custom-category-input"
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="اكتب اسم التصنيف المخصص..."
                  className="w-full text-xs font-medium p-2.5 bg-stone-50 border border-stone-300 rounded-xl focus:outline-none focus:border-stone-900"
                  autoFocus
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {categories.map((cat) => {
                    const isSelected = category === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategory(cat)}
                        className={`py-2 px-2.5 rounded-lg text-xs font-bold transition-all text-center truncate ${
                          isSelected
                            ? kind === 'INCOME'
                              ? 'bg-emerald-100 text-emerald-900 border-2 border-emerald-600'
                              : 'bg-rose-100 text-rose-900 border-2 border-rose-600'
                            : 'bg-stone-100 text-stone-700 hover:bg-stone-200 border-2 border-transparent'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Step 3: المبلغ */}
          <div>
            <label htmlFor="tx-amount-input" className="text-xs font-bold text-stone-700 block mb-1.5">
              {kind === 'TRANSFER' ? '2. المبلغ المحول (بالجنيه)' : '3. المبلغ (بالجنيه المصري)'}
            </label>
            <div className="relative">
              <input
                id="tx-amount-input"
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="0.00"
                className="w-full text-2xl font-black font-mono py-2.5 ps-4 pe-14 bg-stone-50 border-2 border-stone-200 rounded-xl focus:outline-none focus:border-stone-900 focus:bg-white text-stone-900 transition-colors"
                autoFocus={kind === 'TRANSFER' || !isCustomCategory}
              />
              <span className="absolute end-4 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 font-mono">
                ج.م
              </span>
            </div>
          </div>

          {/* Step 4: الماكينة أو الحساب بحسب نوع العملية */}
          {kind === 'INCOME' && (
            <div>
              <label htmlFor="tx-destination-select" className="text-xs font-bold text-stone-700 block mb-1.5">
                4. إلى ماكينة / حساب (المستلم)
              </label>
              <select
                id="tx-destination-select"
                value={destinationMachineId}
                onChange={(e) => setDestinationMachineId(e.target.value)}
                className="w-full text-xs font-bold p-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-stone-900 text-stone-900"
              >
                {machines.map((m) => {
                  const bal = machineBalances[m.id] ?? m.initialBalanceCents;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name} — الرصيد الحالي: {formatCurrency(bal)}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {kind === 'EXPENSE' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="tx-source-select" className="text-xs font-bold text-stone-700">
                  4. من ماكينة / حساب (المصدر المالي)
                </label>
                {sourceMachineId && (
                  <span className={`text-[11px] font-bold font-mono px-2 py-0.5 rounded ${
                    isInsufficientFunds ? 'bg-rose-100 text-rose-700' : 'bg-stone-100 text-stone-700'
                  }`}>
                    الرصيد المتاح: {formatCurrency(sourceBalance)}
                  </span>
                )}
              </div>
              <select
                id="tx-source-select"
                value={sourceMachineId}
                onChange={(e) => setSourceMachineId(e.target.value)}
                className={`w-full text-xs font-bold p-2.5 bg-stone-50 border rounded-xl focus:outline-none text-stone-900 ${
                  isInsufficientFunds ? 'border-rose-400 bg-rose-50/40' : 'border-stone-200 focus:border-stone-900'
                }`}
              >
                {machines.map((m) => {
                  const bal = machineBalances[m.id] ?? m.initialBalanceCents;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name} — (المتاح: {formatCurrency(bal)})
                    </option>
                  );
                })}
              </select>
              {isInsufficientFunds && (
                <div className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-rose-600">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>تنبيه مالي: المبلغ المطلوب أكبر من الرصيد المتاح في هذا الحساب!</span>
                </div>
              )}
            </div>
          )}

          {kind === 'TRANSFER' && (
            <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-200/60 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="tx-transfer-source-select" className="text-xs font-bold text-amber-900">
                      من ماكينة / حساب (المصدر)
                    </label>
                  </div>
                  <select
                    id="tx-transfer-source-select"
                    value={sourceMachineId}
                    onChange={(e) => setSourceMachineId(e.target.value)}
                    className={`w-full text-xs font-bold p-2.5 bg-white border rounded-xl focus:outline-none text-stone-900 ${
                      isInsufficientFunds ? 'border-rose-400' : 'border-amber-300 focus:border-amber-600'
                    }`}
                  >
                    <option value="">اختر الماكينة المصدر...</option>
                    {machines.map((m) => {
                      const bal = machineBalances[m.id] ?? m.initialBalanceCents;
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name} — ({formatCurrency(bal)})
                        </option>
                      );
                    })}
                  </select>
                  {sourceMachineId && (
                    <div className="mt-1 text-[11px] font-bold text-amber-800">
                      الرصيد المتاح: {formatCurrency(sourceBalance)}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="tx-transfer-destination-select" className="text-xs font-bold text-amber-900 block mb-1.5">
                    إلى ماكينة / حساب (المستلم)
                  </label>
                  <select
                    id="tx-transfer-destination-select"
                    value={destinationMachineId}
                    onChange={(e) => setDestinationMachineId(e.target.value)}
                    className="w-full text-xs font-bold p-2.5 bg-white border border-amber-300 rounded-xl focus:outline-none focus:border-amber-600 text-stone-900"
                  >
                    <option value="">اختر الماكينة المستلمة...</option>
                    {machines.map((m) => {
                      const bal = machineBalances[m.id] ?? m.initialBalanceCents;
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name} — ({formatCurrency(bal)})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {isInsufficientFunds && (
                <div className="flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                  <span>تنبيه: رصيد الماكينة المصدر لا يكفي لإتمام هذا التحويل.</span>
                </div>
              )}
            </div>
          )}

          {/* Step 5: البيان (الوصف) */}
          <div>
            <label htmlFor="tx-description-input" className="text-xs font-bold text-stone-700 block mb-1.5">
              {kind === 'TRANSFER' ? '4. البيان أو سبب التحويل (اختياري)' : '5. البيان أو الملاحظة (اختياري)'}
            </label>
            <input
              id="tx-description-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                kind === 'TRANSFER'
                  ? 'مثال: تغذية رصيد الشحن، نقل نقدية...'
                  : 'مثال: تحصيل قسط فلان، كروت شحن، بنزين، سحب شخصي...'
              }
              className="w-full text-xs font-medium p-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-stone-900"
            />
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex items-center gap-2">
            <button
              id="save-tx-btn"
              type="submit"
              disabled={isSubmitting || !!isInsufficientFunds}
              className={`flex-1 py-3 px-4 font-bold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 text-white ${
                isSubmitting || isInsufficientFunds
                  ? 'opacity-50 cursor-not-allowed bg-stone-400'
                  : kind === 'INCOME'
                  ? 'bg-emerald-700 hover:bg-emerald-800 cursor-pointer'
                  : kind === 'EXPENSE'
                  ? 'bg-rose-700 hover:bg-rose-800 cursor-pointer'
                  : 'bg-amber-600 hover:bg-amber-700 cursor-pointer'
              }`}
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>
                {isSubmitting
                  ? 'جاري التسجيل...'
                  : kind === 'TRANSFER'
                  ? 'تسجيل التحويل الداخلي'
                  : 'تسجيل الحركة في اليومية'}
              </span>
            </button>

            <button
              id="cancel-tx-btn"
              type="button"
              disabled={isSubmitting}
              onClick={() => setIsAddTransactionOpen(false)}
              className="py-3 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};
