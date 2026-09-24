import { supabase, isSupabaseConfigured } from './supabase';

export interface CreateMachineParams {
  machineId: string;
  name: string;
}

export interface CreateMachineRpcResult {
  success: boolean;
  machine_id: string;
  name: string;
  initial_balance_cents: number;
  is_active: boolean;
}

export interface RenameMachineParams {
  machineId: string;
  newName: string;
}

export interface RenameMachineRpcResult {
  success: boolean;
  machine_id: string;
  new_name: string;
}

export interface SetMachineActiveParams {
  machineId: string;
  isActive: boolean;
}

export interface SetMachineActiveRpcResult {
  success: boolean;
  machine_id: string;
  is_active: boolean;
}

export function mapMachineRpcError(err: { message?: string } | Error | unknown): Error {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);

  if (message.includes('ERR_UNAUTHENTICATED')) {
    return new Error('انتهت صلاحية جلسة الاتصال. برجاء إعادة تحميل الصفحة.');
  }
  if (message.includes('ERR_SYSTEM_NOT_INITIALIZED')) {
    return new Error('النظام غير مهيأ بعد. يرجى تهيئة اليوم الأول أولاً.');
  }
  if (message.includes('ERR_RESERVED_MACHINE_ID')) {
    return new Error('معرف الماكينة محجوز للنظام ولا يمكن استخدامه.');
  }
  if (message.includes('ERR_MACHINE_ALREADY_EXISTS')) {
    return new Error('يوجد ماكينة مسجلة بهذا المعرف مسبقاً.');
  }
  if (message.includes('ERR_MACHINE_NAME_ALREADY_EXISTS')) {
    return new Error('اسم الماكينة مستخدم بالفعل. يرجى اختيار اسم آخر.');
  }
  if (message.includes('ERR_MACHINE_NOT_FOUND')) {
    return new Error('الماكينة المطلوب تعديلها أو تغيير حالتها غير موجودة بالنظام.');
  }
  if (message.includes('ERR_CANNOT_DISABLE_CASH_DRAWER')) {
    return new Error('لا يمكن تعطيل درج الكاش الأساسي.');
  }
  if (message.includes('ERR_MACHINE_BALANCE_NOT_ZERO')) {
    return new Error('لا يمكن تعطيل الماكينة لأن رصيدها الحالي لا يساوي صفراً.');
  }
  if (message.includes('ERR_INVALID_MACHINE')) {
    return new Error('بيانات الماكينة غير صالحة. يرجى إدخال اسم صالح.');
  }
  if (message.includes('ERR_INVALID_PAYLOAD')) {
    return new Error('بيانات العملية غير صالحة.');
  }

  return new Error(message);
}

/**
 * 1. rpc_create_machine
 * Creates a new machine account with zero initial balance after system initialization.
 * Database contract:
 *   p_id TEXT
 *   p_name TEXT
 */
export async function createMachineRpc(params: CreateMachineParams): Promise<CreateMachineRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const id = params.machineId.trim();
  if (!id) {
    throw new Error('معرف الماكينة مطلوب');
  }

  const name = params.name.trim();
  if (!name) {
    throw new Error('اسم الماكينة أو الحساب مطلوب');
  }

  const { data, error } = await supabase.rpc('rpc_create_machine', {
    p_id: id,
    p_name: name,
  });

  if (error) {
    throw mapMachineRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.machine_id) {
    throw new Error('فشل إنشاء الماكينة: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as CreateMachineRpcResult;
}

/**
 * 2. rpc_rename_machine
 * Renames an existing machine account without affecting any balances.
 * Database contract:
 *   p_id TEXT
 *   p_new_name TEXT
 */
export async function renameMachineRpc(params: RenameMachineParams): Promise<RenameMachineRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const id = params.machineId.trim();
  if (!id) {
    throw new Error('معرف الماكينة مطلوب لإعادة التسمية');
  }

  const newName = params.newName.trim();
  if (!newName) {
    throw new Error('الاسم الجديد للماكينة مطلوب');
  }

  const { data, error } = await supabase.rpc('rpc_rename_machine', {
    p_id: id,
    p_new_name: newName,
  });

  if (error) {
    throw mapMachineRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.machine_id) {
    throw new Error('فشل إعادة تسمية الماكينة: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as RenameMachineRpcResult;
}

/**
 * 3. rpc_set_machine_active
 * Activates or deactivates a machine account. Deactivation requires zero derived balance.
 * Database contract:
 *   p_id TEXT
 *   p_is_active BOOLEAN
 */
export async function setMachineActiveRpc(params: SetMachineActiveParams): Promise<SetMachineActiveRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const id = params.machineId.trim();
  if (!id) {
    throw new Error('معرف الماكينة مطلوب لتغيير الحالة');
  }

  if (params.isActive === null || params.isActive === undefined) {
    throw new Error('حالة التفعيل مطلوبة');
  }

  const { data, error } = await supabase.rpc('rpc_set_machine_active', {
    p_id: id,
    p_is_active: Boolean(params.isActive),
  });

  if (error) {
    throw mapMachineRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.machine_id) {
    throw new Error('فشل تحديث حالة الماكينة: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as SetMachineActiveRpcResult;
}
