import React, { useState, useEffect } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Check, AlertCircle, Info, ShieldAlert } from 'lucide-react';
import { useCash } from '../context/CashContext';
import {
  TransactionKind,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_TRANSFER_CATEGORY,
} from '../types';
import { parseAmountToCents, fromCents, formatCurrency } from '../utils/money';

export const EditTransactionModal: React.FC = () => {
  const {
    editingTransaction,
    setEditingTransaction,
    updateTransaction,
    machines,
    machineBalances,
  } = useCash();

  const [kind, setKind] = useState<TransactionKind>('INCOME');
  const [category, setCategory] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [sourceMachineId, setSourceMachineId] = useState<string>('');
  const [destinationMachineId, setDestinationMachineId] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editingTransaction) {
      setKind(editingTransaction.transactionKind);
      setCategory(editingTransaction.category);
      setAmountInput(String(fromCents(editingTransaction.amountCents)));
      setDescription(editingTransaction.description || '');
      setSourceMachineId(editingTransaction.sourceMachineAccountId || '');
      setDestinationMachineId(editingTransaction.destinationMachineAccountId || '');
      setErrorMessage(null);
    }
  }, [editingTransaction]);

  if (!editingTransaction) return null;

  const handleKindChange = (newKind: TransactionKind) => {
    setKind(newKind);
    setErrorMessage(null);

    if (newKind === 'INCOME') {
      setCategory(DEFAULT_INCOME_CATEGORIES[0]);
    } else if (newKind === 'EXPENSE') {
      setCategory(DEFAULT_EXPENSE_CATEGORIES[0]);
    } else {
      setCategory(DEFAULT_TRANSFER_CATEGORY);
    }
  };

  const categories = kind === 'INCOME' ? DEFAULT_INCOME_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMessage(null);

    const parsed = parseAmountToCents(amountInput);
    if (parsed.error || parsed.cents <= 0) {
      setErrorMessage(parsed.error || 'برجاء كتابة مبلغ صحيح أكبر من صفر');
      return;
    }

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

    setIsSubmitting(true);
    try {
      updateTransaction(editingTransaction.id, {
        transactionKind: kind,
        category: kind === 'TRANSFER' ? DEFAULT_TRANSFER_CATEGORY : category,
        amountCents: parsed.cents,
        description: description.trim(),
        sourceMachineAccountId: kind === 'INCOME' ? undefined : (sourceMachineId || undefined),
        destinationMachineAccountId: kind === 'EXPENSE' ? undefined : (destinationMachineId || undefined),
        timestamp: editingTransaction.timestamp,
      });

      setEditingTransaction(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'فشل تعديل الحركة');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="edit-transaction-modal-backdrop"
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) setEditingTransaction(null);
      }}
    >
      <div
        id="edit-transaction-modal"
        className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in slide-in-from-bottom-6 duration-200"
      >
        <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-stone-900 leading-tight">تعديل الحركة</h3>
            <p className="text-xs text-stone-500 mt-0.5">سيتم إعادة حساب جميع الأرصدة تلقائياً فور الحفظ</p>
          </div>
          <button
            id="close-edit-tx-btn"
            type="button"
            onClick={() => setEditingTransaction(null)}
            className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {/* نوع العملية */}
          <div>
            <label className="text-xs font-bold text-stone-700 block mb-1.5">نوع العملية</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleKindChange('INCOME')}
                className={`py-2 px-2 rounded-xl font-bold text-xs flex flex-col sm:flex-row items-center justify-center gap-1.5 border-2 transition-all cursor-pointer ${
                  kind === 'INCOME'
                    ? 'bg-emerald-700 border-emerald-700 text-white shadow-sm'
                    : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-emerald-50/50'
                }`}
              >
                <ArrowDownLeft className="w-3.5 h-3.5 stroke-[3]" />
                <span>دخل (إيراد)</span>
              </button>

              <button
                type="button"
                onClick={() => handleKindChange('EXPENSE')}
                className={`py-2 px-2 rounded-xl font-bold text-xs flex flex-col sm:flex-row items-center justify-center gap-1.5 border-2 transition-all cursor-pointer ${
                  kind === 'EXPENSE'
                    ? 'bg-rose-700 border-rose-700 text-white shadow-sm'
                    : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-rose-50/50'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5 stroke-[3]" />
                <span>خرج (مصروف)</span>
              </button>

              <button
                type="button"
                onClick={() => handleKindChange('TRANSFER')}
                className={`py-2 px-2 rounded-xl font-bold text-xs flex flex-col sm:flex-row items-center justify-center gap-1.5 border-2 transition-all cursor-pointer ${
                  kind === 'TRANSFER'
                    ? 'bg-amber-600 border-amber-600 text-white shadow-sm'
                    : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-amber-50/50'
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5 stroke-[3]" />
                <span>تحويل ماكينات</span>
              </button>
            </div>
          </div>

          {kind === 'TRANSFER' && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs font-semibold flex items-start gap-2 leading-relaxed">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>التحويل ينقل الفلوس بين الماكينات فقط ولا يغيّر إجمالي فلوس النشاط.</span>
            </div>
          )}

          {/* التصنيف */}
          {kind !== 'TRANSFER' && (
            <div>
              <label className="text-xs font-bold text-stone-700 block mb-1.5">التصنيف</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-2">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold text-center truncate ${
                      category === cat
                        ? kind === 'INCOME'
                          ? 'bg-emerald-100 text-emerald-900 border-2 border-emerald-600'
                          : 'bg-rose-100 text-rose-900 border-2 border-rose-600'
                        : 'bg-stone-100 text-stone-700 hover:bg-stone-200 border-2 border-transparent'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="أو اكتب التصنيف هنا..."
                className="w-full text-xs font-medium p-2 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:border-stone-900"
              />
            </div>
          )}

          {/* المبلغ */}
          <div>
            <label htmlFor="edit-tx-amount" className="text-xs font-bold text-stone-700 block mb-1.5">المبلغ (ج.م)</label>
            <div className="relative">
              <input
                id="edit-tx-amount"
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setErrorMessage(null);
                }}
                className="w-full text-2xl font-black font-mono py-2.5 ps-4 pe-14 bg-stone-50 border-2 border-stone-200 rounded-xl focus:outline-none focus:border-stone-900 text-stone-900"
              />
              <span className="absolute end-4 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 font-mono">ج.م</span>
            </div>
          </div>

          {/* الماكينات */}
          {kind === 'INCOME' && (
            <div>
              <label htmlFor="edit-tx-dest" className="text-xs font-bold text-stone-700 block mb-1.5">إلى ماكينة / حساب</label>
              <select
                id="edit-tx-dest"
                value={destinationMachineId}
                onChange={(e) => setDestinationMachineId(e.target.value)}
                className="w-full text-xs font-bold p-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-stone-900"
              >
                {machines.map((m) => {
                  const bal = machineBalances[m.id] ?? m.initialBalanceCents;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name} — (الرصيد: {formatCurrency(bal)})
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {kind === 'EXPENSE' && (
            <div>
              <label htmlFor="edit-tx-source" className="text-xs font-bold text-stone-700 block mb-1.5">من ماكينة / حساب</label>
              <select
                id="edit-tx-source"
                value={sourceMachineId}
                onChange={(e) => setSourceMachineId(e.target.value)}
                className="w-full text-xs font-bold p-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-stone-900"
              >
                {machines.map((m) => {
                  const bal = machineBalances[m.id] ?? m.initialBalanceCents;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name} — (الرصيد: {formatCurrency(bal)})
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {kind === 'TRANSFER' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-amber-50/50 rounded-xl border border-amber-200/60">
              <div>
                <label htmlFor="edit-tx-transfer-src" className="text-xs font-bold text-amber-900 block mb-1.5">من ماكينة (المصدر)</label>
                <select
                  id="edit-tx-transfer-src"
                  value={sourceMachineId}
                  onChange={(e) => setSourceMachineId(e.target.value)}
                  className="w-full text-xs font-bold p-2.5 bg-white border border-amber-300 rounded-xl focus:outline-none focus:border-amber-600"
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
              </div>

              <div>
                <label htmlFor="edit-tx-transfer-dest" className="text-xs font-bold text-amber-900 block mb-1.5">إلى ماكينة (المستلم)</label>
                <select
                  id="edit-tx-transfer-dest"
                  value={destinationMachineId}
                  onChange={(e) => setDestinationMachineId(e.target.value)}
                  className="w-full text-xs font-bold p-2.5 bg-white border border-amber-300 rounded-xl focus:outline-none focus:border-amber-600"
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
          )}

          {/* البيان */}
          <div>
            <label htmlFor="edit-tx-desc" className="text-xs font-bold text-stone-700 block mb-1.5">البيان أو الملاحظة</label>
            <input
              id="edit-tx-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full text-xs font-medium p-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-stone-900"
            />
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="pt-2 flex items-center gap-2">
            <button
              id="confirm-edit-tx-btn"
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 bg-stone-900 hover:bg-stone-800 text-white font-bold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>{isSubmitting ? 'جاري الحفظ...' : 'حفظ التعديلات وإعادة الحساب'}</span>
            </button>

            <button
              id="cancel-edit-tx-btn"
              type="button"
              disabled={isSubmitting}
              onClick={() => setEditingTransaction(null)}
              className="py-3 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
