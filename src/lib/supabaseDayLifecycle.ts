import { supabase, isSupabaseConfigured } from './supabase';

export interface MachineOpeningInput {
  id: string;
  opening_balance_cents: number;
  machine_account_id?: string;
}

export interface StartNextDayParams {
  businessDate: string; // DATE format YYYY-MM-DD
  openingBusinessCents: number; // BIGINT non-negative
  machineOpenings?: MachineOpeningInput[];
}

export interface StartNextDayRpcResult {
  success: boolean;
  day_id: string;
  business_date: string;
  status: string;
  opening_business_cents: number;
  total_allocated_cents: number;
  unallocated_cash_cents: number;
  machine_openings: Array<{
    machine_account_id: string;
    name: string;
    opening_balance_cents: number;
  }>;
}

export interface SetOpeningBalanceParams {
  dayId: string;
  newOpeningBusinessCents: number;
  machineOpenings?: MachineOpeningInput[] | null;
}

export interface SetOpeningBalanceRpcResult {
  success: boolean;
  day_id: string;
  business_date: string;
  status: string;
  opening_business_balance_cents: number;
  allocated_machine_cents: number;
  unallocated_cash_cents: number;
  machine_openings: Array<{
    machine_account_id: string;
    name: string;
    opening_balance_cents: number;
  }>;
}

export interface CloseDayParams {
  dayId: string;
  actualClosingCents: number;
  notes?: string | null;
}

export interface CloseDayRpcResult {
  success: boolean;
  day_id: string;
  status: string;
  business_date: string;
  opening_business_cents: number;
  expected_closing_cents: number;
  actual_closing_cents: number;
  difference_cents: number;
  notes: string | null;
}

/**
 * Maps PostgreSQL and Supabase RPC error codes into clear Arabic user messages.
 */
export function mapDayLifecycleRpcError(err: { message?: string } | Error | unknown): Error {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);

  if (message.includes('ERR_UNAUTHENTICATED')) {
    return new Error('انتهت صلاحية جلسة الاتصال. برجاء إعادة تحميل الصفحة.');
  }
  if (message.includes('ERR_NO_PREVIOUS_DAY')) {
    return new Error('لا يوجد يوم سابق مسجل في النظام لترحيل الدورة منه.');
  }
  if (message.includes('ERR_LATEST_DAY_NOT_CLOSED')) {
    return new Error('اليوم الحالي ما زال مفتوحاً. يجب إغلاق اليوم الحالي أولاً قبل بدء يوم جديد.');
  }
  if (message.includes('ERR_MISSING_ACTUAL_CLOSING')) {
    return new Error('اليوم السابق لا يحتوي على رصيد إغلاق فعلي مسجل.');
  }
  if (message.includes('ERR_OPEN_DAY_ALREADY_EXISTS')) {
    return new Error('يوجد يوم مفتوح بالفعل في النظام.');
  }
  if (message.includes('ERR_INVALID_BUSINESS_DATE')) {
    return new Error('تاريخ اليوم الجديد غير صالح (يجب أن يكون بعد تاريخ آخر يوم مسجل).');
  }
  if (message.includes('ERR_DATE_ALREADY_EXISTS')) {
    return new Error('يوجد يوم مسجل بهذا التاريخ مسبقاً.');
  }
  if (message.includes('ERR_OPENING_SUM_EXCEEDS_BUSINESS')) {
    return new Error('لا يمكن أن يتجاوز مجموع مخصصات الماكينات رصيد بداية النشاط.');
  }
  if (message.includes('ERR_OPENING_LESS_THAN_ALLOCATED')) {
    return new Error('لا يمكن أن يكون رصيد بداية اليوم أقل من إجمالي المبالغ الموزعة على الماكينات.');
  }
  if (message.includes('ERR_MISSING_CASH_DRAWER')) {
    return new Error('حساب درج الكاش الأساسي غير موجود أو غير مفعل.');
  }
  if (message.includes('ERR_DAY_ALREADY_CLOSED')) {
    return new Error('اليوم مغلق بالفعل.');
  }
  if (message.includes('ERR_DAY_CLOSED')) {
    return new Error('لا يمكن تعديل رصيد البداية ليوم مغلق.');
  }
  if (message.includes('ERR_DAY_NOT_FOUND')) {
    return new Error('اليوم المحدد غير موجود في النظام.');
  }
  if (message.includes('ERR_INVALID_CLOSING_AMOUNT')) {
    return new Error('المبلغ الفعلي للإغلاق غير صالح. يجب أن يكون رقماً موجباً أو صفراً.');
  }
  if (message.includes('ERR_INVALID_AMOUNT')) {
    return new Error('المبلغ غير صالح. يجب أن يكون رقماً صحيحاً موجباً أو صفراً.');
  }
  if (message.includes('ERR_INVALID_MACHINE')) {
    return new Error('معرف الماكينة غير صالح.');
  }
  if (message.includes('ERR_ACCOUNT_NOT_FOUND')) {
    return new Error('حساب الماكينة غير موجود بالنظام.');
  }
  if (message.includes('ERR_ACCOUNT_INACTIVE')) {
    return new Error('حساب الماكينة غير نشط.');
  }
  if (message.includes('ERR_DUPLICATE_MACHINE_OPENING')) {
    return new Error('تكرار في مخصصات نفس الماكينة.');
  }
  if (message.includes('ERR_INVALID_PAYLOAD')) {
    return new Error('بيانات العملية غير صالحة.');
  }

  return new Error(message);
}

/**
 * 1. rpc_start_next_day
 * Atomically starts next day with manually supplied opening balance and machine allocations.
 * Zero automatic rollover from previous day.
 * Database contract:
 *   p_business_date DATE
 *   p_opening_business_cents BIGINT
 *   p_machine_openings JSONB
 */
export async function startNextDayRpc(params: StartNextDayParams): Promise<StartNextDayRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const businessDate = params.businessDate.trim();
  if (!businessDate) {
    throw new Error('تاريخ اليوم الجديد مطلوب');
  }

  const openingCents = Math.max(0, Math.round(params.openingBusinessCents));

  const openingsPayload = params.machineOpenings
    ? params.machineOpenings.map((m) => ({
        id: m.id.trim(),
        machine_account_id: m.id.trim(),
        opening_balance_cents: Math.max(0, Math.round(m.opening_balance_cents)),
      }))
    : [];

  const { data, error } = await supabase.rpc('rpc_start_next_day', {
    p_business_date: businessDate,
    p_opening_business_cents: openingCents,
    p_machine_openings: openingsPayload,
  });

  if (error) {
    throw mapDayLifecycleRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.day_id) {
    throw new Error('فشل بدء اليوم الجديد: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as StartNextDayRpcResult;
}

/**
 * 2. rpc_set_opening_balance
 * Modifies the opening business balance (and machine allocations) of the CURRENT OPEN day only.
 * Database contract:
 *   p_day_id TEXT
 *   p_new_opening_business_cents BIGINT
 *   p_machine_openings JSONB
 */
export async function setOpeningBalanceRpc(
  params: SetOpeningBalanceParams
): Promise<SetOpeningBalanceRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const dayId = params.dayId.trim();
  if (!dayId) {
    throw new Error('معرف اليوم مطلوب لتعديل رصيد البداية');
  }

  const openingCents = Math.max(0, Math.round(params.newOpeningBusinessCents));

  const openingsPayload =
    params.machineOpenings !== undefined && params.machineOpenings !== null
      ? params.machineOpenings.map((m) => ({
          id: m.id.trim(),
          machine_account_id: m.id.trim(),
          opening_balance_cents: Math.max(0, Math.round(m.opening_balance_cents)),
        }))
      : null;

  const { data, error } = await supabase.rpc('rpc_set_opening_balance', {
    p_day_id: dayId,
    p_new_opening_business_cents: openingCents,
    p_machine_openings: openingsPayload,
  });

  if (error) {
    throw mapDayLifecycleRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.day_id) {
    throw new Error('فشل تعديل رصيد بداية اليوم: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as SetOpeningBalanceRpcResult;
}

/**
 * 3. rpc_close_day
 * Atomically marks OPEN day as CLOSED and records physical counted closing balance.
 * No reconciliation transactions created.
 * Database contract:
 *   p_day_id TEXT
 *   p_actual_closing_cents BIGINT
 *   p_notes TEXT
 */
export async function closeDayRpc(params: CloseDayParams): Promise<CloseDayRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة البيانات Supabase غير مهيأ');
  }

  const dayId = params.dayId.trim();
  if (!dayId) {
    throw new Error('معرف اليوم مطلوب لإغلاقه');
  }

  const actualClosingCents = Math.max(0, Math.round(params.actualClosingCents));
  const notes = params.notes && params.notes.trim() ? params.notes.trim() : null;

  const { data, error } = await supabase.rpc('rpc_close_day', {
    p_day_id: dayId,
    p_actual_closing_cents: actualClosingCents,
    p_notes: notes,
  });

  if (error) {
    throw mapDayLifecycleRpcError(error);
  }

  if (!data || typeof data !== 'object' || !data.success || !data.day_id) {
    throw new Error('فشل إغلاق اليومية: استجابة غير صالحة من قاعدة البيانات');
  }

  return data as CloseDayRpcResult;
}
