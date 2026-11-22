import { describe, expect, test } from 'bun:test';
import {
  amountText,
  expenseTotals,
  parseExpenses,
  readExpenseAmount,
  type TripExpense,
} from '../src/lib/expenses';

const expense: TripExpense = {
  id: 'ferry',
  day: '2026-05-01',
  title: 'Ferry ticket',
  category: 'Transport',
  currency: 'USD',
  amount_minor: 125,
};

describe('trip expenses', () => {
  test('parses local decimal input into the original currency’s minor units', () => {
    expect(readExpenseAmount('0.29', 'USD')).toBe(29);
    expect(readExpenseAmount(',5', 'EUR')).toBe(50);
    expect(readExpenseAmount('800', 'JPY')).toBe(800);
    expect(readExpenseAmount('1.025', 'KWD')).toBe(1025);
    for (const bad of ['0', '-1', '1.205', '1,000.50', '1e3', '9007199254740992']) {
      expect(() => readExpenseAmount(bad, 'USD')).toThrow();
    }
    expect(() => readExpenseAmount('10.5', 'JPY')).toThrow();
  });
  test('totals stay exact and separate by currency', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(
      expenseTotals([
        expense,
        { ...expense, currency: 'JPY', amount_minor: 600 },
        { ...expense, amount_minor: max },
      ]),
    ).toEqual([
      ['JPY', 600n],
      ['USD', BigInt(max) + 125n],
    ]);
    expect(amountText(max, 'USD')).toBe('90071992547409.91');
    expect(amountText(12500, 'JPY', true)).toBe('12,500');
  });
  test('rejects damaged records and duplicate identities', () => {
    expect(parseExpenses([expense])).toEqual([expense]);
    for (const raw of [
      [expense, expense],
      [{ ...expense, day: '2026-02-30' }],
      [{ ...expense, amount_minor: 3.25 }],
      [{ ...expense, title: ' ' }],
      null,
    ]) {
      expect(() => parseExpenses(raw)).toThrow();
    }
  });
});
