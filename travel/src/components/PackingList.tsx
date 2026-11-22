import { useRef, useState } from 'react';
import { changePacking, packingItems, type PackingChange } from '../lib/packing';
import { createId } from '../lib/identity';
import { text_limits } from '../lib/model';
import type { Trip } from '../lib/types';
import { EditorForm } from './EditorForm';
import { Icon } from './Icon';
import '../packing.css';

export function PackingList({
  trip,
  onChange,
}: {
  trip: Trip;
  onChange(update: (current: Trip) => Trip): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [new_title, setNewTitle] = useState('');
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<{ change: PackingChange; message: string } | null>(null);
  const in_flight = useRef(false);
  const items = packingItems(trip);
  const packed = items.filter((item) => item.packed).length;
  const disabled = saving || Boolean(failed);

  async function save(change: PackingChange) {
    if (in_flight.current) return;
    if ((change.kind === 'add' || change.kind === 'rename') && !change.title.trim()) return;
    in_flight.current = true;
    setSaving(true);
    setFailed(null);
    try {
      await onChange((current) => changePacking(current, change));
      if (change.kind === 'add') setNewTitle('');
      if (change.kind === 'rename') setRename(null);
    } catch (reason) {
      setFailed({
        change,
        message:
          reason instanceof Error ? reason.message : 'Could not save this packing list change.',
      });
    } finally {
      in_flight.current = false;
      setSaving(false);
    }
  }
  return (
    <section className="packing-list" aria-labelledby="packing-list-title">
      <header className="packing-heading">
        <h2 id="packing-list-title">Packing list</h2>
        {items.length > 0 && (
          <button
            type="button"
            className="packing-edit"
            disabled={disabled || Boolean(rename)}
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Done' : 'Edit items'}
          </button>
        )}
      </header>
      <p className="packing-progress-text" role="status">
        {packed} of {items.length} packed
      </p>
      <progress
        className="packing-progress"
        aria-label="Packing progress"
        max={Math.max(1, items.length)}
        value={packed}
      />
      {items.length > 0 && (
        <ul className="packing-items" aria-label="Packing items">
          {items.map((item) => (
            <li key={item.id} className="packing-row">
              {rename?.id === item.id ? (
                <EditorForm
                  onSave={() => save({ kind: 'rename', id: item.id, title: rename.title })}
                >
                  {(submit) => (
                    <div className="packing-rename">
                      <input
                        type="text"
                        required
                        aria-label="Item name"
                        autoFocus
                        maxLength={text_limits.packing_title}
                        disabled={disabled}
                        value={rename.title}
                        onChange={(e) => setRename({ ...rename, title: e.target.value })}
                      />
                      <button
                        type="button"
                        className="packing-edit"
                        disabled={disabled}
                        onClick={() => setRename(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="packing-edit"
                        disabled={disabled || !rename.title.trim()}
                        onClick={submit}
                      >
                        Save item
                      </button>
                    </div>
                  )}
                </EditorForm>
              ) : editing ? (
                <>
                  <button
                    className="packing-rename-button"
                    type="button"
                    aria-label={'Rename ' + item.title}
                    disabled={disabled || Boolean(rename)}
                    onClick={() => setRename({ id: item.id, title: item.title })}
                  >
                    <Icon name="edit" size={16} />
                    <span>{item.title}</span>
                  </button>
                  <button
                    className="packing-remove"
                    type="button"
                    aria-label={'Remove ' + item.title}
                    disabled={disabled || Boolean(rename)}
                    onClick={() => void save({ kind: 'remove', id: item.id })}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </>
              ) : (
                <label className="packing-toggle">
                  <input
                    type="checkbox"
                    checked={item.packed}
                    disabled={disabled}
                    onChange={(e) =>
                      void save({ kind: 'pack', id: item.id, packed: e.target.checked })
                    }
                  />
                  <span>{item.title}</span>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
      {!rename && (
        <EditorForm onSave={() => save({ kind: 'add', id: createId(), title: new_title })}>
          {(submit) => (
            <div className="packing-add">
              <input
                type="text"
                required
                aria-label="Item name"
                placeholder="Item name"
                maxLength={text_limits.packing_title}
                value={new_title}
                disabled={disabled}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <button
                className="primary"
                type="button"
                disabled={disabled || !new_title.trim()}
                onClick={submit}
              >
                <Icon name="plus" size={16} />
                Add item
              </button>
            </div>
          )}
        </EditorForm>
      )}
      {failed && (
        <div className="packing-failure" role="alert">
          <p>{failed.message}</p>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => setFailed(null)}>
              Cancel change
            </button>
            <button type="button" className="primary" onClick={() => void save(failed.change)}>
              Retry
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
