import { supabase, isSupabaseConfigured } from './supabase';
import { TransactionKind } from '../types';

export interface AddIncomeParams {
  dayId: string;
  destId: string;
  amountCents: number;
  category: string;
  description?: string;
  timestamp: string;
}

export interface AddExpenseParams {
  dayId: string;
  sourceId: string;
  amountCents: number;
  category: string;
  description?: string;
  timestamp: string;
}

export interface AddTransferParams {
  dayId: string;
  sourceId: string;
  destId: string;
  amountCents: number;
  category: string;
  description?: string;
  timestamp: string;
}

export interface RpcMutationResult {
  success: boolean;
  transaction_id: string;
  transaction_kind: TransactionKind;
  day_id: string;
  source_machine_account_id?: string;
  destination_machine_account_id?: string;
  amount_cents: number;
  business_effect_cents: number;
  machine_effect_cents?: number;
  source_machine_effect_cents?: number;
  destination_machine_effect_cents?: number;
}

function mapRpcError(err: { message?: string } | Error | unknown): Error {
  const message = (err && typeof err === 'object' && 'message' in err)
    ? String((err as { message: unknown }).message)
    : String(err);

  if (message.includes('ERR_UNAUTHENTICATED')) {
    return new Error('انتهت صلاحية جلسة الاتصال. برجاء إعادة تحميل الصفحة.');
  }
  if (message.includes('ERR_TRANSACTION_NOT_FOUND')) {
    return new Error('الحركة المطلوب تعديلها أو حذفها غير مسجلة بالنظام.');
  }
  if (message.includes('ERR_DAY_NOT_FOUND')) {
    return new Error('اليوم المحدد غير مسجل بالنظام.');
  }
  if (message.includes('ERR_DAY_CLOSED')) {
    return new Error('اليوم المرتبط بهذه الحركة مغلق. لا يمكن تعديل أو حذف حركات عليه.');
  }
  if (message.includes('ERR_ACCOUNT_NOT_FOUND')) {
    return new Error('الماكينة أو الحساب المحدد غير موجود.');
  }
  if (message.includes('ERR_ACCOUNT_INACTIVE')) {
    return new Error('الماكينة أو الحساب المحدد غير نشط.');
  }
  if (message.includes('ERR_MACHINE_NOT_AVAILABLE_FOR_DAY')) {
    return new Error('الماكينة غير مخصصة لهذا اليوم.');
  }
  if (message.includes('ERR_INSUFFICIENT_FUNDS')) {
    return new Error('رصيد الماكينة غير كافٍ لإتمام هذه العملية (قد يتسبب في رصيد سالب).');
  }
  if (message.includes('ERR_SAME_ACCOUNT_TRANSFER')) {
    return new Error('لا يمكن التحويل من وإلى نفس الماكينة / الحساب.');
  }
  if (message.includes('ERR_INVALID_AMOUNT')) {
    return new Error('المبلغ يجب أن يكون رقماً صحيحاً موجباً أكبر من صفر.');
  }
  if (message.includes('ERR_INVALID_CATEGORY')) {
    return new Error('تصنيف الحركة مطلوب.');
  }
  if (message.includes('ERR_INVALID_TRANSACTION_KIND')) {
    return new Error('نوع الحركة المحدد غير صالح.');
  }
  if (message.includes('ERR_INVALID_TRANSACTION_SEMANTICS')) {
    return new Error('بيانات الماكينات لا تتطابق مع نوع الحركة.');
  }
  if (message.includes('ERR_INVALID_TIMESTAMP')) {
    return new Error('توقيت الحركة غير صالح.');
  }

  return new Error(message);
}

/**
 * 1. rpc_add_income
 * Real money entering the business into destination machine account.
 * Database contract:
 *   p_day_id TEXT
 *   p_dest_id TEXT
 *   p_amount BIGINT
 *   p_category TEXT
 *   p_desc TEXT
 *   p_timestamp TIMESTAMPTZ
 */
export async function addIncomeRpc(params: AddIncomeParams): Promise<RpcMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const { data, error } = await supabase.rpc('rpc_add_income', {
    p_day_id: params.dayId.trim(),
    p_dest_id: params.destId.trim(),
    p_amount: Math.round(params.amountCents),
    p_category: params.category.trim(),
    p_desc: params.description ? params.description.trim() : '',
    p_timestamp: params.timestamp,
  });

  if (error) {
    throw mapRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.transaction_id) {
    throw new Error('فشل تسجيل حركة الإيراد: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as RpcMutationResult;
}

/**
 * 2. rpc_add_expense
 * Real money leaving the business from source machine account.
 * Database contract:
 *   p_day_id TEXT
 *   p_source_id TEXT
 *   p_amount BIGINT
 *   p_category TEXT
 *   p_desc TEXT
 *   p_timestamp TIMESTAMPTZ
 */
export async function addExpenseRpc(params: AddExpenseParams): Promise<RpcMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const { data, error } = await supabase.rpc('rpc_add_expense', {
    p_day_id: params.dayId.trim(),
    p_source_id: params.sourceId.trim(),
    p_amount: Math.round(params.amountCents),
    p_category: params.category.trim(),
    p_desc: params.description ? params.description.trim() : '',
    p_timestamp: params.timestamp,
  });

  if (error) {
    throw mapRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.transaction_id) {
    throw new Error('فشل تسجيل حركة المصروف: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as RpcMutationResult;
}

/**
 * 3. rpc_add_transfer
 * Internal transfer between two machine accounts. Business total unchanged.
 * Database contract:
 *   p_day_id TEXT
 *   p_source_id TEXT
 *   p_dest_id TEXT
 *   p_amount BIGINT
 *   p_category TEXT
 *   p_desc TEXT
 *   p_timestamp TIMESTAMPTZ
 */
export async function addTransferRpc(params: AddTransferParams): Promise<RpcMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const { data, error } = await supabase.rpc('rpc_add_transfer', {
    p_day_id: params.dayId.trim(),
    p_source_id: params.sourceId.trim(),
    p_dest_id: params.destId.trim(),
    p_amount: Math.round(params.amountCents),
    p_category: params.category.trim(),
    p_desc: params.description ? params.description.trim() : '',
    p_timestamp: params.timestamp,
  });

  if (error) {
    throw mapRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.transaction_id) {
    throw new Error('فشل تسجيل حركة التحويل: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as RpcMutationResult;
}

export interface UpdateTransactionParams {
  transactionId: string;
  newKind: TransactionKind;
  newAmountCents: number;
  newCategory: string;
  newDescription?: string;
  newSourceId?: string | null;
  newDestId?: string | null;
}

export interface UpdateRpcResult {
  success: boolean;
  transaction_id: string;
  day_id: string;
  kind: TransactionKind;
  amount: number;
  source_id?: string | null;
  destination_id?: string | null;
}

export interface DeleteRpcResult {
  success: boolean;
  transaction_id: string;
  day_id: string;
  deleted: boolean;
}

/**
 * 4. rpc_update_transaction
 * Updates an existing transaction in place with full semantic and balance validation.
 * Database contract:
 *   p_tx_id TEXT
 *   p_new_kind VARCHAR
 *   p_new_amount BIGINT
 *   p_new_category TEXT
 *   p_new_desc TEXT
 *   p_new_source_id TEXT
 *   p_new_dest_id TEXT
 */
export async function updateTransactionRpc(params: UpdateTransactionParams): Promise<UpdateRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const txId = params.transactionId.trim();
  if (!txId) {
    throw new Error('معرف الحركة مطلوب للتعديل');
  }

  const kind = params.newKind;
  const amount = Math.round(params.newAmountCents);
  if (amount <= 0 || !Number.isFinite(amount)) {
    throw new Error('المبلغ يجب أن يكون رقماً صحيحاً موجباً أكبر من صفر');
  }

  const category = params.newCategory.trim();
  if (!category) {
    throw new Error('تصنيف الحركة مطلوب');
  }

  const desc = params.newDescription ? params.newDescription.trim() : '';

  let sourceId: string | null = null;
  let destId: string | null = null;

  if (kind === 'INCOME') {
    if (!params.newDestId || !params.newDestId.trim()) {
      throw new Error('يجب تحديد ماكينة أو حساب استلام النقدية');
    }
    sourceId = null;
    destId = params.newDestId.trim();
  } else if (kind === 'EXPENSE') {
    if (!params.newSourceId || !params.newSourceId.trim()) {
      throw new Error('يجب تحديد ماكينة أو حساب المصدر للخصم منه');
    }
    sourceId = params.newSourceId.trim();
    destId = null;
  } else if (kind === 'TRANSFER') {
    if (!params.newSourceId || !params.newSourceId.trim()) {
      throw new Error('يجب اختيار الماكينة المحول منها');
    }
    if (!params.newDestId || !params.newDestId.trim()) {
      throw new Error('يجب اختيار الماكينة المحول إليها');
    }
    sourceId = params.newSourceId.trim();
    destId = params.newDestId.trim();
    if (sourceId === destId) {
      throw new Error('لا يمكن التحويل من وإلى نفس الماكينة / الحساب');
    }
  } else {
    throw new Error('نوع حركة غير معروف');
  }

  const { data, error } = await supabase.rpc('rpc_update_transaction', {
    p_tx_id: txId,
    p_new_kind: kind,
    p_new_amount: amount,
    p_new_category: category,
    p_new_desc: desc,
    p_new_source_id: sourceId,
    p_new_dest_id: destId,
  });

  if (error) {
    throw mapRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.transaction_id) {
    throw new Error('فشل تعديل الحركة: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as UpdateRpcResult;
}

/**
 * 5. rpc_delete_transaction
 * Deletes an existing transaction from the ledger with strict day and balance protection.
 * Database contract:
 *   p_tx_id TEXT
 */
export async function deleteTransactionRpc(transactionId: string): Promise<DeleteRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const txId = transactionId.trim();
  if (!txId) {
    throw new Error('معرف الحركة مطلوب للحذف');
  }

  const { data, error } = await supabase.rpc('rpc_delete_transaction', {
    p_tx_id: txId,
  });

  if (error) {
    throw mapRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.transaction_id) {
    throw new Error('فشل حذف الحركة: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as DeleteRpcResult;
}

