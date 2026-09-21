/**
 * Financial Safety & Currency Utilities
 *
 * Implements an exact-integer financial strategy:
 * - All monetary values are internally represented as integers in minor units (cents/piasters).
 *   Example: 150.50 EGP is stored as 15050 cents.
 * - This completely prevents JavaScript IEEE 754 floating-point rounding errors (e.g. 0.1 + 0.2 !== 0.3).
 * - Formatted strings are purely for display and are never used as inputs to arithmetic.
 */

// Map eastern Arabic numerals (٠-٩) to western Arabic numerals (0-9)
const ARABIC_TO_WESTERN_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '٫': '.',
  '٬': '',
};

/**
 * Normalizes user input by converting Arabic digits and cleaning thousands separators
 */
export function normalizeNumericInput(input: string): string {
  if (!input) return '';
  return input
    .replace(/[٠-٩٫٬]/g, (match) => ARABIC_TO_WESTERN_DIGITS[match] ?? match)
    .replace(/,/g, '')
    .trim();
}

/**
 * Converts a decimal amount (e.g. 150.5 or "150.50") into integer cents (15050)
 */
export function toCents(amount: number | string): number {
  if (typeof amount === 'string') {
    const normalized = normalizeNumericInput(amount);
    const parsed = parseFloat(normalized);
    if (isNaN(parsed) || !isFinite(parsed)) return 0;
    return Math.round(parsed * 100);
  }
  if (isNaN(amount) || !isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

/**
 * Converts integer cents back to standard decimal number (15050 -> 150.5)
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Safely parses user input into integer cents.
 * Returns null if the value is empty, invalid, <= 0, or non-numeric.
 */
export function parseAmountToCents(rawInput: string): { cents: number; error?: string } {
  const normalized = normalizeNumericInput(rawInput);
  if (!normalized) {
    return { cents: 0, error: 'برجاء إدخال المبلغ' };
  }

  const num = Number(normalized);
  if (isNaN(num) || !isFinite(num)) {
    return { cents: 0, error: 'المبلغ غير صحيح' };
  }

  if (num <= 0) {
    return { cents: 0, error: 'يجب أن يكون المبلغ أكبر من صفر' };
  }

  // Cap at 100 million to prevent integer overflow or absurd mistakes
  if (num > 100_000_000) {
    return { cents: 0, error: 'المبلغ المدخل كبير جداً' };
  }

  const cents = Math.round(num * 100);
  return { cents };
}

/**
 * Formats integer cents into standard Arabic currency string (ج.م)
 * E.g., 15050 -> "150.50 ج.م" or 15000 -> "150 ج.م"
 */
export function formatCurrency(
  cents: number,
  options?: {
    showCurrency?: boolean;
    showSign?: boolean;
    alwaysShowDecimals?: boolean;
  }
): string {
  const { showCurrency = true, showSign = false, alwaysShowDecimals = false } = options || {};

  const isNegative = cents < 0;
  const absCents = Math.abs(cents);
  const pounds = Math.floor(absCents / 100);
  const remainingCents = absCents % 100;

  // Format the thousands with standard commas
  const poundsFormatted = pounds.toLocaleString('en-US');

  let amountStr = poundsFormatted;
  if (alwaysShowDecimals || remainingCents > 0) {
    amountStr = `${poundsFormatted}.${remainingCents.toString().padStart(2, '0')}`;
  }

  let prefix = '';
  if (showSign) {
    if (cents > 0) prefix = '+ ';
    else if (isNegative) prefix = '- ';
  } else if (isNegative) {
    prefix = '- ';
  }

  const currencyLabel = showCurrency ? ' ج.م' : '';
  return `${prefix}${amountStr}${currencyLabel}`;
}

/**
 * Convenient alias for formatCurrency
 */
export const formatEGP = formatCurrency;

/**
 * Exact integer additions and subtractions
 */
export function safeAdd(...centsList: number[]): number {
  return centsList.reduce((acc, curr) => {
    const val = typeof curr === 'number' && Number.isFinite(curr) ? Math.round(curr) : 0;
    return acc + val;
  }, 0);
}

export function safeSubtract(aCents: number, bCents: number): number {
  const a = typeof aCents === 'number' && Number.isFinite(aCents) ? Math.round(aCents) : 0;
  const b = typeof bCents === 'number' && Number.isFinite(bCents) ? Math.round(bCents) : 0;
  return a - b;
}
