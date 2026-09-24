import React, { useState } from 'react';
import {
  Plus,
  Smartphone,
  Trash2,
  ArrowUpDown,
  ShieldCheck,
  Edit2,
  Edit3,
  Power,
  PowerOff,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Check,
  X,
} from 'lucide-react';
import { useCash } from '../context/CashContext';
import { formatCurrency, formatEGP, parseAmountToCents, fromCents } from '../utils/money';
import { MachineAccount } from '../types';

export const MachinesView: React.FC = () => {
  const {
    machines,
    machineBalances,
    transactions,
    setIsAddMachineOpen,
    deleteMachine,
    renameMachine,
    setMachineActive,
    updateMachineInitialBalance,
    dailySummary,
    currentDay,
  } = useCash();

  const [editingMachineId, setEditingMachineId] = useState<string | null>(null);
  const [initialBalanceInput, setInitialBalanceInput] = useState<string>('');
  const [editingMachineNameId, setEditingMachineNameId] = useState<string | null>(null);
  const [machineNameInput, setMachineNameInput] = useState<string>('');
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  const [isTogglingActive, setIsTogglingActive] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Total balance currently in all machines combined
  const totalInMachines = machines.reduce((acc, m) => {
    return acc + (machineBalances[m.id] ?? m.initialBalanceCents);
  }, 0);

  const handleStartRename = (machine: MachineAccount) => {
    setEditingMachineNameId(machine.id);
    setMachineNameInput(machine.name);
    setEditError(null);
  };

  const handleSaveRename = async (id: string) => {
    if (isRenaming) return;
    const trimmed = machineNameInput.trim();
    if (!trimmed) {
      setEditError('برجاء كتابة اسم الماكينة أو الحساب');
      return;
    }
    setIsRenaming(true);
    setEditError(null);
    try {
      await renameMachine(id, trimmed);
      setEditingMachineNameId(null);
      setEditError(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'حدث خطأ أثناء تعديل الاسم');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleToggleMachineActive = async (machine: MachineAccount) => {
    if (isTogglingActive) return;
    if (machine.id === 'm-cash-drawer' && machine.isActive) {
      setEditError('لا يمكن تعطيل درج الكاش الأساسي.');
      return;
    }

    const actionText = machine.isActive ? 'تعطيل' : 'تنشيط';
    let msg = `هل أنت متأكد من ${actionText} "${machine.name}"؟`;
    if (machine.isActive) {
      const hasTransactions = transactions.some(
        (tx) => tx.sourceMachineAccountId === machine.id || tx.destinationMachineAccountId === machine.id
      );
      if (hasTransactions) {
        msg += `\nتنبيه: ستبقى الحركات المسجلة السابقة محفوظة بدقة في السجل.`;
      }
      const curBal = machineBalances[machine.id] ?? machine.initialBalanceCents;
      if (curBal !== 0) {
        msg += `\nتنبيه: رصيد الماكينة الحالي (${formatCurrency(curBal)}). يشترط تصفير الرصيد للتعطيل.`;
      }
    }

    if (window.confirm(msg)) {
      setIsTogglingActive(machine.id);
      setEditError(null);
      try {
        await setMachineActive(machine.id, !machine.isActive);
      } catch (err) {
        setEditError(err instanceof Error ? err.message : `حدث خطأ أثناء ${actionText} الماكينة`);
      } finally {
        setIsTogglingActive(null);
      }
    }
  };

  const handleDeleteMachine = (id: string, name: string) => {
    const target = machines.find((m) => m.id === id);
    if (target) {
      handleToggleMachineActive(target);
    } else {
      let msg = `هل أنت متأكد من إزالة "${name}" من قائمة الماكينات؟`;
      if (window.confirm(msg)) {
        deleteMachine(id).catch((err) => {
          setEditError(err instanceof Error ? err.message : 'حدث خطأ أثناء حذف الماكينة');
        });
      }
    }
  };

  const handleStartEditBalance = (id: string, currentCents: number) => {
    setEditingMachineId(id);
    setInitialBalanceInput(String(fromCents(currentCents)));
    setEditError(null);
  };

  const handleSaveInitialBalance = (id: string) => {
    const parsed = parseAmountToCents(initialBalanceInput);
    if (parsed.error || parsed.cents < 0) {
      setEditError(parsed.error || 'المبلغ غير صحيح');
      return;
    }
    try {
      updateMachineInitialBalance(id, parsed.cents);
      setEditingMachineId(null);
      setEditError(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'حدث خطأ');
    }
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Header with Title & Action */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div>
          <h2 className="text-2xl font-black text-stone-900 tracking-tight">الماكينات والحسابات</h2>
          <p className="text-xs text-stone-500 font-medium mt-0.5">
            توزيع النقدية والأرصدة اللحظية في الماكينات، المحافظ، والتحويلات الداخلية
          </p>
        </div>

        <button
          id="add-machine-top-btn"
          type="button"
          onClick={() => setIsAddMachineOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>+ إضافة ماكينة</span>
        </button>
      </div>

      {/* Aggregate Overview Card */}
      <div
        id="machines-total-card"
        className="rounded-xl bg-white p-5 border border-stone-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-stone-100 text-stone-800 flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-stone-800" />
          </div>
          <div>
            <span className="text-xs font-semibold text-stone-500">إجمالي الأرصدة الحالية في الماكينات</span>
            <div className="text-2xl font-extrabold text-stone-900 font-mono mt-0.5">
              {formatCurrency(totalInMachines)}
            </div>
          </div>
        </div>

        {dailySummary.unallocatedOpeningCents > 0 && (
          <div className="flex items-center gap-2 text-xs bg-amber-50 text-amber-900 px-3.5 py-2 rounded-xl border border-amber-200">
            <span className="font-semibold">المتبقي غير الموزع من افتتاح اليوم:</span>
            <span className="font-mono font-bold text-amber-950">{formatCurrency(dailySummary.unallocatedOpeningCents)}</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-stone-600 bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-100">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>الرصيد مشتق تلقائياً: رصيد البداية + الداخل + تحويل وارد - الخارج - تحويل صادر</span>
        </div>
      </div>

      {editError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
          {editError}
        </div>
      )}

      {/* Machines List */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-stone-900">
          قائمة الماكينات والحسابات النشطة ({machines.length})
        </h3>

        {machines.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-stone-300 p-8 text-center">
            <Smartphone className="w-8 h-8 text-stone-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-stone-700">لا توجد أي ماكينات مضافة</p>
            <p className="text-xs text-stone-400 mt-1">
              أضف ماكينات فوري، ممكن، فودافون كاش أو أي حسابات أخرى لتتبعها بدقة
            </p>
            <button
              id="empty-add-machine-btn"
              type="button"
              onClick={() => setIsAddMachineOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة ماكينة الآن</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {machines.map((machine) => {
              const currentBalance = machineBalances[machine.id] ?? machine.initialBalanceCents;

              // Calculate breakdown for this specific machine
              let incomeSum = 0;
              let expenseSum = 0;
              let transferInSum = 0;
              let transferOutSum = 0;
              let txCount = 0;

              for (const tx of transactions) {
                if (tx.transactionKind === 'INCOME' && tx.destinationMachineAccountId === machine.id) {
                  incomeSum += tx.amountCents;
                  txCount++;
                } else if (tx.transactionKind === 'EXPENSE' && tx.sourceMachineAccountId === machine.id) {
                  expenseSum += tx.amountCents;
                  txCount++;
                } else if (tx.transactionKind === 'TRANSFER') {
                  if (tx.destinationMachineAccountId === machine.id) {
                    transferInSum += tx.amountCents;
                    txCount++;
                  }
                  if (tx.sourceMachineAccountId === machine.id) {
                    transferOutSum += tx.amountCents;
                    txCount++;
                  }
                }
              }

              const isEditing = editingMachineId === machine.id;

              return (
                <div
                  key={machine.id}
                  id={`machine-card-${machine.id}`}
                  className={`bg-white rounded-xl p-4 border shadow-xs hover:border-stone-300 transition-colors flex flex-col justify-between ${
                    machine.isActive ? 'border-stone-200' : 'border-stone-300 bg-stone-50/60 opacity-90'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-stone-900 text-amber-400 flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
                        {machine.name.slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        {editingMachineNameId === machine.id ? (
                          <div className="flex items-center gap-1.5 my-0.5">
                            <input
                              id={`rename-machine-input-${machine.id}`}
                              type="text"
                              value={machineNameInput}
                              disabled={isRenaming}
                              onChange={(e) => setMachineNameInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(machine.id);
                                if (e.key === 'Escape') setEditingMachineNameId(null);
                              }}
                              className="text-xs font-bold p-1 bg-stone-100 border border-stone-300 rounded focus:outline-none focus:border-stone-900 w-full max-w-[160px]"
                              autoFocus
                            />
                            <button
                              id={`save-rename-machine-${machine.id}`}
                              type="button"
                              disabled={isRenaming}
                              onClick={() => handleSaveRename(machine.id)}
                              className="p-1 bg-stone-900 text-white rounded hover:bg-stone-800 disabled:opacity-50 cursor-pointer"
                              title="حفظ الاسم"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              id={`cancel-rename-machine-${machine.id}`}
                              type="button"
                              disabled={isRenaming}
                              onClick={() => {
                                setEditingMachineNameId(null);
                                setEditError(null);
                              }}
                              className="p-1 bg-stone-200 text-stone-600 rounded hover:bg-stone-300 disabled:opacity-50 cursor-pointer"
                              title="إلغاء"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-bold text-stone-900 truncate">{machine.name}</h4>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                                machine.isActive
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-stone-100 text-stone-500 border-stone-200'
                              }`}
                            >
                              {machine.isActive ? 'نشطة' : 'معطلة'}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mt-0.5">
                          <ArrowUpDown className="w-3 h-3 text-stone-400" />
                          <span>{txCount} حركة مسجلة</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        id={`rename-machine-${machine.id}`}
                        type="button"
                        onClick={() => handleStartRename(machine)}
                        title="إعادة تسمية الماكينة"
                        className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        id={`edit-initial-machine-${machine.id}`}
                        type="button"
                        onClick={() => handleStartEditBalance(machine.id, machine.initialBalanceCents)}
                        title="تعديل رصيد بداية اليوم للماكينة"
                        className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        id={`delete-machine-${machine.id}`}
                        type="button"
                        disabled={isTogglingActive === machine.id}
                        onClick={() => handleToggleMachineActive(machine)}
                        title={machine.isActive ? 'تعطيل الماكينة' : 'تنشيط الماكينة'}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                          machine.isActive
                            ? 'text-stone-400 hover:text-rose-600 hover:bg-rose-50'
                            : 'text-emerald-600 hover:bg-emerald-50'
                        } disabled:opacity-50`}
                      >
                        {machine.isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Flow breakdown pill stats */}
                  <div className="mt-3 pt-2 border-t border-stone-100 grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="flex items-center justify-between text-stone-600 bg-stone-50 px-2 py-1 rounded">
                      <span className="flex items-center gap-1 text-emerald-700 font-medium">
                        <ArrowDownLeft className="w-3 h-3" /> دخل:
                      </span>
                      <span className="font-mono font-bold">+{formatCurrency(incomeSum)}</span>
                    </div>

                    <div className="flex items-center justify-between text-stone-600 bg-stone-50 px-2 py-1 rounded">
                      <span className="flex items-center gap-1 text-rose-700 font-medium">
                        <ArrowUpRight className="w-3 h-3" /> خرج:
                      </span>
                      <span className="font-mono font-bold">-{formatCurrency(expenseSum)}</span>
                    </div>

                    <div className="flex items-center justify-between text-stone-600 bg-amber-50/70 px-2 py-1 rounded">
                      <span className="flex items-center gap-1 text-amber-800 font-medium">
                        <ArrowLeftRight className="w-3 h-3" /> تحويل وارد:
                      </span>
                      <span className="font-mono font-bold text-amber-900">+{formatCurrency(transferInSum)}</span>
                    </div>

                    <div className="flex items-center justify-between text-stone-600 bg-amber-50/70 px-2 py-1 rounded">
                      <span className="flex items-center gap-1 text-amber-800 font-medium">
                        <ArrowLeftRight className="w-3 h-3" /> تحويل صادر:
                      </span>
                      <span className="font-mono font-bold text-amber-900">-{formatCurrency(transferOutSum)}</span>
                    </div>
                  </div>

                  {/* Bottom: Opening balance vs Current Calculated Balance */}
                  <div className="mt-3 pt-3 border-t border-stone-100 flex items-baseline justify-between">
                    <div>
                      <span className="text-[11px] text-stone-400 block">رصيد البداية</span>
                      {isEditing ? (
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={initialBalanceInput}
                            onChange={(e) => setInitialBalanceInput(e.target.value)}
                            className="w-20 text-xs font-mono font-bold p-1 bg-stone-100 border border-stone-300 rounded focus:outline-none focus:border-stone-900"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveInitialBalance(machine.id)}
                            className="p-1 bg-stone-900 text-white rounded hover:bg-stone-800 cursor-pointer"
                            title="حفظ"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingMachineId(null)}
                            className="p-1 bg-stone-200 text-stone-600 rounded hover:bg-stone-300 cursor-pointer"
                            title="إلغاء"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-stone-600 font-mono">
                          {formatCurrency(machine.initialBalanceCents)}
                        </span>
                      )}
                    </div>

                    <div className="text-left">
                      <span className="text-[11px] text-stone-500 block font-medium">الرصيد المشتق الآن</span>
                      <span className="text-lg font-bold text-stone-900 font-mono">
                        {formatCurrency(currentBalance)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Helper note */}
      <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 text-xs text-stone-600 leading-relaxed">
        <p className="font-bold text-stone-800 mb-1">💡 ملحوظة لصاحب العمل:</p>
        يمكنك إضافة أي عدد من الماكينات أو الحسابات بأسماء مخصصة (مثال: ماكينة ممكن، ماكينة فوري، Vodafone Cash، محفظة إلكترونية، أو درج الكاش).
        التحويلات بين الماكينات تنقل الأرصدة بدقة من الماكينة المحول منها إلى المحول إليها مع بقاء إجمالي النشاط ثابتاً 100%.
      </div>
    </div>
  );
};
