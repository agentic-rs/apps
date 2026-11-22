import { useState } from 'react';
import type { Trip } from '../lib/types';
import { formatTripDates } from '../lib/dates';
import { createId } from '../lib/identity';
import {
  amountText,
  currency_codes,
  expense_categories,
  expenseTotals,
  readExpenseAmount,
  type TripExpense,
} from '../lib/expenses';
import { Dialog, DiscardPrompt } from './Dialog';
import { EditorForm } from './EditorForm';
import { Icon } from './Icon';

function ExpenseForm({
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  initial: TripExpense;
  onSave(value: TripExpense): Promise<void>;
  onDelete?(): Promise<void>;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(initial);
  const initial_amount = initial.amount_minor
    ? amountText(initial.amount_minor, initial.currency)
    : '';
  const [amount, setAmount] = useState(initial_amount);
  const [prompt, setPrompt] = useState<'discard' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const currencies =
    draft.currency && !currency_codes.includes(draft.currency)
      ? [draft.currency, ...currency_codes]
      : currency_codes;
  function dismiss() {
    if (busy) return;
    if (prompt) {
      setPrompt(null);
      return;
    }
    if (
      draft.title !== initial.title ||
      draft.day !== initial.day ||
      draft.currency !== initial.currency ||
      draft.category !== initial.category ||
      amount !== initial_amount
    )
      setPrompt('discard');
    else onClose();
  }
  async function submit(deleting = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (deleting && onDelete) await onDelete();
      else
        await onSave({
          ...draft,
          title: draft.title.trim(),
          amount_minor: readExpenseAmount(amount, draft.currency),
        });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your expense.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={onDelete ? 'Edit expense' : 'Add expense'} full_screen onDismiss={dismiss}>
      <EditorForm onSave={() => submit()}>
        {(save) => (
          <>
            <fieldset className="form-body" disabled={busy || Boolean(prompt)}>
              <label>
                Expense name
                <input
                  required
                  autoFocus
                  value={draft.title}
                  maxLength={200}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>
              <div className="form-grid">
                <label>
                  Amount
                  <input
                    required
                    value={amount}
                    inputMode="decimal"
                    maxLength={24}
                    aria-describedby="expense-amount-help"
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  Currency
                  <select
                    required
                    value={draft.currency}
                    onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                  >
                    <option value="">Choose currency</option>
                    {currencies.map((code) => (
                      <option key={code}>{code}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="field-help" id="expense-amount-help">
                Enter the amount without thousands separators.
              </p>
              <div className="form-grid">
                <label>
                  Date
                  <input
                    type="date"
                    required
                    value={draft.day}
                    onChange={(e) => setDraft({ ...draft, day: e.target.value })}
                  />
                </label>
                <label>
                  Category
                  <select
                    value={draft.category}
                    onChange={(e) =>
                      setDraft({ ...draft, category: e.target.value as TripExpense['category'] })
                    }
                  >
                    {expense_categories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
              </div>
              {onDelete && (
                <button className="text-danger" type="button" onClick={() => setPrompt('delete')}>
                  Delete expense
                </button>
              )}
            </fieldset>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {prompt === 'discard' && (
              <DiscardPrompt disabled={busy} onKeep={() => setPrompt(null)} onDiscard={onClose} />
            )}
            {prompt === 'delete' && (
              <div className="discard-prompt" role="alert">
                <p>Delete “{initial.title}” from this trip?</p>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setPrompt(null)}
                  >
                    Keep expense
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void submit(true)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
            <footer className="dialog-footer">
              <button type="button" className="secondary" disabled={busy} onClick={dismiss}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={save} disabled={busy || !!prompt}>
                {busy ? 'Saving…' : 'Save expense'}
              </button>
            </footer>
          </>
        )}
      </EditorForm>
    </Dialog>
  );
}

export function Expenses({
  trip,
  day,
  onChange,
}: {
  trip: Trip;
  day: string;
  onChange(update: (current: Trip) => Trip): Promise<void>;
}) {
  const [editor, setEditor] = useState<{ expense: TripExpense; existing: boolean } | null>(null);
  const expenses = trip.expenses ?? [];
  const groups = new Map<string, TripExpense[]>();
  for (const expense of expenses) {
    const items = groups.get(expense.day) ?? [];
    items.push(expense);
    groups.set(expense.day, items);
  }
  const totals = expenseTotals(expenses);
  function openNew() {
    setEditor({
      existing: false,
      expense: {
        id: createId(),
        title: '',
        day,
        currency: expenses.at(-1)?.currency ?? '',
        amount_minor: 0,
        category: 'Other',
      },
    });
  }
  return (
    <section className="expenses" aria-label="Trip expenses">
      <div className="tool-heading">
        <h2>Expenses</h2>
        <button className="primary" onClick={openNew}>
          <Icon name="plus" size={16} />
          Add expense
        </button>
      </div>
      {totals.length > 0 ? (
        <>
          <div className="expense-totals" aria-label="Trip totals">
            <span>Trip total</span>
            {totals.map(([currency, total]) => (
              <strong key={currency}>
                {currency} {amountText(total, currency, true)}
              </strong>
            ))}
          </div>
          {[...groups.keys()]
            .sort()
            .reverse()
            .map((date) => (
              <section key={date} className="expense-day">
                <h3>{formatTripDates(date, date)}</h3>
                <ul className="tool-rows">
                  {groups.get(date)!.map((expense) => (
                    <li key={expense.id}>
                      <button
                        aria-label={`Edit expense ${expense.title}`}
                        onClick={() => setEditor({ expense, existing: true })}
                      >
                        <span className="tool-row-copy">
                          <strong>{expense.title}</strong>
                          <small>{expense.category}</small>
                        </span>
                        <span className="expense-amount">
                          {expense.currency}{' '}
                          {amountText(expense.amount_minor, expense.currency, true)}
                        </span>
                        <Icon name="next" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </>
      ) : (
        <p className="tool-empty">
          Record what you spend each day. Each currency has its own trip total.
        </p>
      )}
      {editor && (
        <ExpenseForm
          initial={editor.expense}
          onClose={() => setEditor(null)}
          onDelete={
            editor.existing
              ? () =>
                  onChange((current) => ({
                    ...current,
                    expenses: (current.expenses ?? []).filter(
                      (item) => item.id !== editor.expense.id,
                    ),
                  }))
              : undefined
          }
          onSave={(value) =>
            onChange((current) => {
              const items = current.expenses ?? [];
              if (editor.existing && !items.some((item) => item.id === value.id))
                throw new Error('This expense has been removed.');
              return {
                ...current,
                expenses: editor.existing
                  ? items.map((item) => (item.id === value.id ? value : item))
                  : [...items, value],
              };
            })
          }
        />
      )}
    </section>
  );
}
