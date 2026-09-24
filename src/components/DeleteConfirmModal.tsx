import React, { useState } from 'react';
import { Trash2, AlertTriangle, X, ShieldAlert } from 'lucide-react';
import { useCash } from '../context/CashContext';
import { formatEGP } from '../utils/money';
import { canDeleteTransaction } from '../utils/calculations';

export const DeleteConfirmModal: React.FC = () => {
  const {
    deletingTransaction,
    setDeletingTransaction,
    deleteTransaction,
    machines,
    machineBalances,
  } = useCash();

  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!deletingTransaction) return null;

  const machineMap = new Map(machines.map((m) => [m.id, m.name]));
  const machineNamesObj = Object.fromEntries(machines.map((m) => [m.id, m.name]));

  const deleteCheck = canDeleteTransaction(deletingTransaction, machineBalances, machineNamesObj);

  const handleConfirm = async () => {
    if (isDeleting) return;
    if (!deleteCheck.allowed) {
      setErrorMessage(deleteCheck.error || 'لا يمكن حذف هذه الحركة');
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await deleteTransaction(deletingTransaction.id);
      setDeletingTransaction(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'فشل حذف الحركة');
    } finally {
      setIsDeleting(false);
    }
  };

  const getSourceDestLabel = () => {
    if (deletingTransaction.transactionKind === 'TRANSFER') {
      const src = machineMap.get(deletingTransaction.sourceMachineAccountId || '') || 'ماكينة غير محددة';
      const dest = machineMap.get(deletingTransaction.destinationMachineAccountId || '') || 'ماكينة غير محددة';
      return `من: ${src} ⬅️ إلى: ${dest}`;
    }
    if (deletingTransaction.transactionKind === 'INCOME') {
      return deletingTransaction.destinationMachineAccountId
        ? `المستلم: ${machineMap.get(deletingTransaction.destinationMachineAccountId)}`
        : 'نقدية عامة';
    }
    return deletingTransaction.sourceMachineAccountId
      ? `المصدر: ${machineMap.get(deletingTransaction.sourceMachineAccountId)}`
      : 'درج الكاش';
  };

  return (
    <div
      id="delete-confirm-modal-backdrop"
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) setDeletingTransaction(null);
      }}
    >
      <div
        id="delete-confirm-modal"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-rose-50/50">
          <div className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
            <h3 className="text-base font-bold">تأكيد حذف الحركة</h3>
          </div>
          <button
            type="button"
            disabled={isDeleting}
            onClick={() => setDeletingTransaction(null)}
            className="w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-stone-700 leading-relaxed font-medium">
            هل أنت متأكد من رغبتك في حذف هذه الحركة؟ سيتم تحديث جميع الأرصدة المتأثرة فورياً.
          </p>

          {!deleteCheck.allowed && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800 font-medium leading-relaxed">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold text-rose-900 mb-0.5">منع مالي للحماية من الرصيد السالب:</strong>
                {deleteCheck.error}
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-bold">
              {errorMessage}
            </div>
          )}

          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-stone-500 font-semibold">نوع الحركة:</span>
              <span className="font-bold text-stone-800">
                {deletingTransaction.transactionKind === 'INCOME'
                  ? 'دخل (إيراد)'
                  : deletingTransaction.transactionKind === 'EXPENSE'
                  ? 'خرج (مصروف)'
                  : 'تحويل بين الماكينات'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-stone-500 font-semibold">المبلغ:</span>
              <span className="font-mono font-black text-sm text-stone-900">
                {formatEGP(deletingTransaction.amountCents)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-stone-500 font-semibold">التصنيف:</span>
              <span className="font-bold text-stone-700">{deletingTransaction.category}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-stone-500 font-semibold">الحسابات:</span>
              <span className="font-semibold text-stone-700">{getSourceDestLabel()}</span>
            </div>

            {deletingTransaction.description && (
              <div className="pt-1 border-t border-stone-200 text-stone-600 italic">
                "{deletingTransaction.description}"
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              id="confirm-delete-btn"
              type="button"
              disabled={isDeleting || !deleteCheck.allowed}
              onClick={handleConfirm}
              className={`flex-1 py-2.5 px-4 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5 text-white ${
                !deleteCheck.allowed || isDeleting
                  ? 'bg-stone-300 cursor-not-allowed text-stone-500'
                  : 'bg-rose-700 hover:bg-rose-800 cursor-pointer'
              }`}
            >
              <Trash2 className="w-4 h-4" />
              <span>{isDeleting ? 'جاري الحذف...' : 'نعم، احذف الحركة'}</span>
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => setDeletingTransaction(null)}
              className="py-2.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
