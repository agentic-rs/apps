import { isCalendarDate } from './dates';

export const expense_categories = [
  'Food',
  'Transport',
  'Stay',
  'Activity',
  'Shopping',
  'Other',
] as const;
type ExpenseCategory = (typeof expense_categories)[number];

export interface TripExpense {
  id: string;
  title: string;
  day: string;
  category: ExpenseCategory;
  currency: string;
  amount_minor: number;
}

export const currency_codes =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('currency')
    : [
        'AUD',
        'CAD',
        'CHF',
        'CNY',
        'EUR',
        'GBP',
        'HKD',
        'INR',
        'JPY',
        'KRW',
        'KWD',
        'NZD',
        'SGD',
        'THB',
        'USD',
      ];

function fractionDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Choose a currency.');
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

export function readExpenseAmount(input: string, currency: string): number {
  const digits = fractionDigits(currency);
  const parts = /^(\d{0,16})(?:[.,](\d+))?$/.exec(input.trim());
  if (!parts || (!parts[1] && !parts[2]))
    throw new Error('Enter a positive amount without grouping separators.');
  const fraction = parts[2] ?? '';
  if (fraction.length > digits)
    throw new Error(
      digits
        ? `Use at most ${digits} decimal places for ${currency}.`
        : `Use a whole amount for ${currency}.`,
    );
  const minor = Number(parts[1] + fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0)
    throw new Error('Enter a positive amount within the supported range.');
  return minor;
}

export function amountText(
  amount_minor: number | bigint,
  currency: string,
  grouped = false,
): string {
  const digits = fractionDigits(currency);
  const scale = 10n ** BigInt(digits);
  const minor = BigInt(amount_minor);
  const whole = minor / scale;
  const amount = grouped ? whole.toLocaleString('en-GB') : String(whole);
  return digits ? amount + '.' + String(minor % scale).padStart(digits, '0') : amount;
}

export function parseExpenses(value: unknown): TripExpense[] {
  if (!Array.isArray(value)) throw new Error('Trip expenses must be a list.');
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) ||
      ids.has(item.id)
    )
      throw new Error('An expense has an invalid or repeated ID.');
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200)
      throw new Error('Enter an expense name of up to 200 characters.');
    if (typeof item.day !== 'string' || !isCalendarDate(item.day))
      throw new Error('Choose a valid expense date.');
    if (!expense_categories.includes(item.category)) throw new Error('Choose an expense category.');
    if (typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency))
      throw new Error('Choose a currency.');
    if (!Number.isSafeInteger(item.amount_minor) || item.amount_minor <= 0)
      throw new Error('The expense amount must be positive.');
    ids.add(item.id);
    return {
      id: item.id,
      day: item.day,
      title: item.title.trim(),
      category: item.category,
      currency: item.currency,
      amount_minor: item.amount_minor,
    };
  });
}

export function expenseTotals(expenses: readonly TripExpense[]) {
  const totals = new Map<string, bigint>();
  for (const expense of expenses) {
    totals.set(
      expense.currency,
      (totals.get(expense.currency) ?? 0n) + BigInt(expense.amount_minor),
    );
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b));
}
