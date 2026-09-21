import { newDb } from 'pg-mem';
import fs from 'fs';
import path from 'path';

export function runPhase1SchemaVerification() {
  console.log('=====================================================');
  console.log('SUPABASE PHASE 1: DATABASE FOUNDATION VERIFICATION');
  console.log('=====================================================');

  const db = newDb();

  // Read the migration SQL
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20260920000001_phase1_core_tables.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Strip PL/pgSQL DO $$ ... $$ blocks for in-memory DDL execution, and split standard SQL statements
  const sqlWithoutDoBlocks = sql.replace(/DO\s*\$\$[\s\S]*?\$\$;/gi, '');

  const ddlStatements = sqlWithoutDoBlocks
    .split(';')
    .map(s => s.replace(/--.*$/gm, '').trim())
    .filter(s => s.length > 0);

  for (const statement of ddlStatements) {
    try {
      db.public.none(statement);
    } catch (e: any) {
      // Handle statements that pg-mem has minor dialect variations on (like ALTER TABLE ENABLE RLS)
      if (statement.toUpperCase().includes('ROW LEVEL SECURITY') || statement.toUpperCase().includes('INDEX')) {
        // Continue
      } else {
        throw new Error(`Failed executing statement:\n${statement}\nError: ${e.message}`);
      }
    }
  }

  const results: { name: string; passed: boolean; details: string }[] = [];

  // Verification 1: Tables Created
  const tables = ['days', 'machine_accounts', 'day_machine_openings', 'transactions'];
  for (const t of tables) {
    try {
      const count = db.public.many(`SELECT * FROM ${t}`);
      results.push({
        name: `الجدول الأساسي ${t} موجود وحالته الصفرية مؤكدة`,
        passed: count.length === 0,
        details: `السجلات الموجودة: ${count.length} (صفرية تامة)`,
      });
    } catch (e: any) {
      results.push({
        name: `فحص وجود الجدول ${t}`,
        passed: false,
        details: `خطأ: ${e.message}`,
      });
    }
  }

  // Setup mock user for FK testing
  const mockUserId = 'a0000000-0000-0000-0000-000000000001';
  db.public.none(`INSERT INTO auth.users (id, email) VALUES ('${mockUserId}', 'test@example.com');`);

  // Verification 2: Day Status CHECK constraint
  try {
    db.public.none(`
      INSERT INTO days (id, business_date, status, opening_business_balance_cents, created_by_user_id)
      VALUES ('day-invalid-status', '2026-09-01', 'INVALID_STATUS', 1000, '${mockUserId}');
    `);
    results.push({
      name: 'قيد تحقق حالة اليوم (status IN OPEN, CLOSED)',
      passed: false,
      details: 'تم قبول حالة غير صالحة بشكل خاطئ',
    });
  } catch {
    results.push({
      name: 'قيد تحقق حالة اليوم (status IN OPEN, CLOSED)',
      passed: true,
      details: 'تم رفض إدخال حالة غير صالحة بنجاح',
    });
  }

  // Verification 3: Opening business balance >= 0
  try {
    db.public.none(`
      INSERT INTO days (id, business_date, status, opening_business_balance_cents, created_by_user_id)
      VALUES ('day-neg-opening', '2026-09-02', 'OPEN', -500, '${mockUserId}');
    `);
    results.push({
      name: 'قيد رصيد بداية النشاط (opening_business_balance_cents >= 0)',
      passed: false,
      details: 'تم قبول رصيد سالب بشكل خاطئ',
    });
  } catch {
    results.push({
      name: 'قيد رصيد بداية النشاط (opening_business_balance_cents >= 0)',
      passed: true,
      details: 'تم رفض رصيد بداية سالب بنجاح',
    });
  }

  // Verification 4: Actual closing balance NULL or >= 0
  try {
    db.public.none(`
      INSERT INTO days (id, business_date, status, opening_business_balance_cents, actual_closing_balance_cents, created_by_user_id)
      VALUES ('day-neg-closing', '2026-09-03', 'CLOSED', 1000, -100, '${mockUserId}');
    `);
    results.push({
      name: 'قيد رصيد الإغلاق الفعلي (actual_closing_balance_cents IS NULL OR >= 0)',
      passed: false,
      details: 'تم قبول رصيد إغلاق سالب بشكل خاطئ',
    });
  } catch {
    results.push({
      name: 'قيد رصيد الإغلاق الفعلي (actual_closing_balance_cents IS NULL OR >= 0)',
      passed: true,
      details: 'تم رفض رصيد إغلاق سالب بنجاح',
    });
  }

  // Verification 5: Machine account initial balance >= 0
  try {
    db.public.none(`
      INSERT INTO machine_accounts (id, name, initial_balance_cents)
      VALUES ('m-neg', 'ماكينة سالبة', -500);
    `);
    results.push({
      name: 'قيد رصيد الماكينة الابتدائي (initial_balance_cents >= 0)',
      passed: false,
      details: 'تم قبول رصيد ماكينة سالب',
    });
  } catch {
    results.push({
      name: 'قيد رصيد الماكينة الابتدائي (initial_balance_cents >= 0)',
      passed: true,
      details: 'تم رفض رصيد ماكينة سالب بنجاح',
    });
  }

  // Verification 5b: Unique business_date constraint
  try {
    db.public.none(`
      INSERT INTO days (id, business_date, status, opening_business_balance_cents, created_by_user_id)
      VALUES ('day-dup-1', '2026-09-10', 'CLOSED', 1000, '${mockUserId}');
    `);
    db.public.none(`
      INSERT INTO days (id, business_date, status, opening_business_balance_cents, created_by_user_id)
      VALUES ('day-dup-2', '2026-09-10', 'CLOSED', 2000, '${mockUserId}');
    `);
    results.push({
      name: 'قيد تفرد تاريخ العمل (business_date UNIQUE)',
      passed: false,
      details: 'تم قبول تكرار نفس تاريخ العمل',
    });
  } catch {
    results.push({
      name: 'قيد تفرد تاريخ العمل (business_date UNIQUE)',
      passed: true,
      details: 'تم رفض تكرار تاريخ العمل بنجاح',
    });
  } finally {
    db.public.none(`DELETE FROM days WHERE business_date = '2026-09-10';`);
  }

  // Setup valid day and machines for transaction semantic tests
  db.public.none(`
    INSERT INTO days (id, business_date, status, opening_business_balance_cents, created_by_user_id)
    VALUES ('day-1', '2026-09-20', 'OPEN', 2500000, '${mockUserId}');
  `);
  db.public.none(`
    INSERT INTO machine_accounts (id, name, initial_balance_cents)
    VALUES ('m-fawry', 'فوري', 500000), ('m-momken', 'ممكن', 300000);
  `);
  db.public.none(`
    INSERT INTO day_machine_openings (day_id, machine_account_id, opening_balance_cents)
    VALUES ('day-1', 'm-fawry', 500000), ('day-1', 'm-momken', 300000);
  `);

  // Verification 6: Transaction amount > 0
  try {
    db.public.none(`
      INSERT INTO transactions (id, day_id, transaction_kind, category, amount_cents, destination_machine_account_id, created_by_user_id)
      VALUES ('tx-zero', 'day-1', 'INCOME', 'دخل', 0, 'm-fawry', '${mockUserId}');
    `);
    results.push({
      name: 'قيد مبلغ الحركة (amount_cents > 0)',
      passed: false,
      details: 'تم قبول مبلغ صفر',
    });
  } catch {
    results.push({
      name: 'قيد مبلغ الحركة (amount_cents > 0)',
      passed: true,
      details: 'تم رفض مبلغ صفر أو سالب بنجاح',
    });
  }

  // Verification 7: Semantic rule: INCOME with source account MUST be rejected
  try {
    db.public.none(`
      INSERT INTO transactions (id, day_id, transaction_kind, category, amount_cents, source_machine_account_id, destination_machine_account_id, created_by_user_id)
      VALUES ('tx-bad-inc', 'day-1', 'INCOME', 'دخل غير صالح', 1000, 'm-fawry', 'm-momken', '${mockUserId}');
    `);
    results.push({
      name: 'قيد دلالة الإيراد: منع وجود حساب مصدر (INCOME with source)',
      passed: false,
      details: 'تم قبول إيراد له حساب مصدر',
    });
  } catch {
    results.push({
      name: 'قيد دلالة الإيراد: منع وجود حساب مصدر (INCOME with source)',
      passed: true,
      details: 'تم رفض إيراد له حساب مصدر بنجاح',
    });
  }

  // Verification 8: Semantic rule: EXPENSE with destination account MUST be rejected
  try {
    db.public.none(`
      INSERT INTO transactions (id, day_id, transaction_kind, category, amount_cents, source_machine_account_id, destination_machine_account_id, created_by_user_id)
      VALUES ('tx-bad-exp', 'day-1', 'EXPENSE', 'مصروف غير صالح', 1000, 'm-fawry', 'm-momken', '${mockUserId}');
    `);
    results.push({
      name: 'قيد دلالة المصروف: منع وجود حساب وجهة (EXPENSE with destination)',
      passed: false,
      details: 'تم قبول مصروف له حساب وجهة',
    });
  } catch {
    results.push({
      name: 'قيد دلالة المصروف: منع وجود حساب وجهة (EXPENSE with destination)',
      passed: true,
      details: 'تم رفض مصروف له حساب وجهة بنجاح',
    });
  }

  // Verification 9: Semantic rule: TRANSFER where source = destination MUST be rejected
  try {
    db.public.none(`
      INSERT INTO transactions (id, day_id, transaction_kind, category, amount_cents, source_machine_account_id, destination_machine_account_id, created_by_user_id)
      VALUES ('tx-bad-tr', 'day-1', 'TRANSFER', 'تحويل لنفسه', 1000, 'm-fawry', 'm-fawry', '${mockUserId}');
    `);
    results.push({
      name: 'قيد دلالة التحويل الداخلي: منع تطابق المصدر والوجهة (source <> destination)',
      passed: false,
      details: 'تم قبول تحويل من الماكينة إلى نفسها',
    });
  } catch {
    results.push({
      name: 'قيد دلالة التحويل الداخلي: منع تطابق المصدر والوجهة (source <> destination)',
      passed: true,
      details: 'تم رفض تحويل الحساب لنفسه بنجاح',
    });
  }

  // Verification 10: Valid transactions of all 3 kinds succeed
  try {
    db.public.none(`
      INSERT INTO transactions (id, day_id, transaction_kind, category, amount_cents, destination_machine_account_id, created_by_user_id)
      VALUES ('tx-good-inc', 'day-1', 'INCOME', 'مبيعات', 200000, 'm-fawry', '${mockUserId}');
    `);
    db.public.none(`
      INSERT INTO transactions (id, day_id, transaction_kind, category, amount_cents, source_machine_account_id, created_by_user_id)
      VALUES ('tx-good-exp', 'day-1', 'EXPENSE', 'فواتير', 50000, 'm-momken', '${mockUserId}');
    `);
    db.public.none(`
      INSERT INTO transactions (id, day_id, transaction_kind, category, amount_cents, source_machine_account_id, destination_machine_account_id, created_by_user_id)
      VALUES ('tx-good-tr', 'day-1', 'TRANSFER', 'تحويل رصيد', 100000, 'm-fawry', 'm-momken', '${mockUserId}');
    `);
    results.push({
      name: 'صحة العمليات السليمة (INCOME, EXPENSE, TRANSFER)',
      passed: true,
      details: 'تم إدراج الحركات الدلالية السليمة بنجاح تام',
    });
  } catch (e: any) {
    results.push({
      name: 'صحة العمليات السليمة (INCOME, EXPENSE, TRANSFER)',
      passed: false,
      details: `فشل الإدراج: ${e.message}`,
    });
  }

  // Verification 11: Foreign key delete restrict on machine_accounts -> transactions
  try {
    db.public.none(`DELETE FROM machine_accounts WHERE id = 'm-fawry';`);
    results.push({
      name: 'حماية العلاقات: منع حذف ماكينة لها حركات (ON DELETE RESTRICT)',
      passed: false,
      details: 'تم حذف ماكينة مرتبطة بحركات مالية بشكل خاطئ',
    });
  } catch {
    results.push({
      name: 'حماية العلاقات: منع حذف ماكينة لها حركات (ON DELETE RESTRICT)',
      passed: true,
      details: 'تم منع حذف الماكينة بنجاح لحماية التاريخ المالي',
    });
  }

  // Clean test rows to verify zero-state rule
  db.public.none(`DELETE FROM transactions;`);
  db.public.none(`DELETE FROM day_machine_openings;`);
  db.public.none(`DELETE FROM days;`);
  db.public.none(`DELETE FROM machine_accounts;`);

  const finalDaysCount = db.public.many(`SELECT * FROM days`).length;
  const finalMachinesCount = db.public.many(`SELECT * FROM machine_accounts`).length;
  const finalOpeningsCount = db.public.many(`SELECT * FROM day_machine_openings`).length;
  const finalTransactionsCount = db.public.many(`SELECT * FROM transactions`).length;

  results.push({
    name: 'حالة الصفر التامة لقاعدة البيانات (Zero-state database tables)',
    passed:
      finalDaysCount === 0 &&
      finalMachinesCount === 0 &&
      finalOpeningsCount === 0 &&
      finalTransactionsCount === 0,
    details: `days=${finalDaysCount}, machines=${finalMachinesCount}, openings=${finalOpeningsCount}, transactions=${finalTransactionsCount}`,
  });

  // Verification 12: Static analysis of indexes in migration script
  const expectedIndexes = [
    'idx_days_single_open',
    'idx_days_business_date_desc',
    'idx_transactions_day_timestamp_desc',
    'idx_transactions_source_machine',
    'idx_transactions_dest_machine',
  ];
  for (const idx of expectedIndexes) {
    const hasIdx = sql.includes(idx);
    results.push({
      name: `وجود الفهرس الإلزامي ${idx}`,
      passed: hasIdx,
      details: hasIdx ? 'الفهرس معرّف بالملف التنفيذي' : 'الفهرس مفقود',
    });
  }

  // Verification 13: RLS enabled on all 4 tables
  for (const t of tables) {
    const rlsPattern = new RegExp(`ALTER TABLE\\s+${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    const hasRls = rlsPattern.test(sql);
    results.push({
      name: `تفعيل حماية السجلات (RLS) للجدول ${t}`,
      passed: hasRls,
      details: hasRls ? 'RLS مفعّل بنجاح' : 'غير مفعّل',
    });
  }

  // Verification 14: SELECT policy for authenticated users on all 4 tables
  for (const t of tables) {
    const policyPattern = new RegExp(`CREATE\\s+POLICY[\\s\\S]*?ON\\s+${t}[\\s\\S]*?FOR\\s+SELECT[\\s\\S]*?TO\\s+authenticated`, 'i');
    const hasPolicy = policyPattern.test(sql);
    results.push({
      name: `سياسة القراءة للمصادق عليهم (SELECT policy) للجدول ${t}`,
      passed: hasPolicy,
      details: hasPolicy ? 'سياسة القراءة معرّفة بنجاح' : 'السياسة مفقودة',
    });
  }

  // Verification 15: Table privilege matrix (anon: none, authenticated: SELECT only)
  const hasRevokePublic = sql.includes('REVOKE ALL ON TABLE days FROM PUBLIC');
  const hasGrantSelectAuth = sql.includes('GRANT SELECT ON TABLE days TO authenticated');
  const hasNoAnonGrant = !sql.includes('GRANT SELECT ON TABLE days TO anon') && !sql.includes('GRANT ALL ON TABLE days TO anon');
  results.push({
    name: 'مصفوفة الصلاحيات (anon: NO, authenticated: SELECT only)',
    passed: hasRevokePublic && hasGrantSelectAuth && hasNoAnonGrant,
    details: 'تم حجب كافة الصلاحيات عن anon ومنح SELECT فقط لـ authenticated',
  });

  // Verification 16: Zero RPCs created in this phase
  const rpcCount = (sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/gi) || []).length;
  results.push({
    name: 'عدم إنشاء أي RPC في المرحلة الأولى (Zero RPCs created)',
    passed: rpcCount === 0,
    details: `عدد الدوال المخزنة: ${rpcCount} (ممنوع في المرحلة الأولى)`,
  });

  return results;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('verify-phase1-schema')) {
  const testResults = runPhase1SchemaVerification();
  let allPass = true;
  for (const r of testResults) {
    console.log(`${r.passed ? '✅' : '❌'} ${r.name}`);
    console.log(`   ${r.details}`);
    if (!r.passed) allPass = false;
  }
  if (allPass) {
    console.log('\n🎉 جميع الفحوصات الهيكلية لقاعدة البيانات لمرحلة Supabase Phase 1 نجحت 100%!');
  } else {
    console.error('\n❌ فشل في بعض الفحوصات الهيكلية.');
    process.exit(1);
  }
}
