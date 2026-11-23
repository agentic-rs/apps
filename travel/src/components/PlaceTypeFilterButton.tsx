import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeTypeFilters, type PlaceTypeFilter } from '../lib/place-types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export function PlaceTypeFilterButton({
  category,
  value,
  disabled,
  onSelect,
}: {
  category: 'sight' | 'stay';
  value?: PlaceTypeFilter;
  disabled: boolean;
  onSelect(value?: PlaceTypeFilter): void;
}) {
  const [open, setOpen] = useState(false);
  const selected = useRef<HTMLButtonElement>(null);
  const all = category === 'sight' ? 'All sights' : 'All lodging';
  const options = [{ id: undefined, label: all }, ...placeTypeFilters(category)];
  const title = category === 'sight' ? 'Sight type' : 'Lodging type';
  useLayoutEffect(() => {
    if (open) selected.current?.focus();
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="place-type-filter"
        data-filtered={value ? '' : undefined}
        aria-label={category === 'sight' ? 'Filter sights by type' : 'Filter lodging by type'}
        aria-description={options.find((option) => option.id === value)?.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Icon name="filter" size={20} />
      </button>
      {open &&
        createPortal(
          <Dialog title={title} onDismiss={() => setOpen(false)}>
            <div className="place-type-options" role="group" aria-label={title}>
              {options.map((option) => (
                <button
                  type="button"
                  key={option.id ?? 'all'}
                  aria-pressed={option.id === value}
                  ref={option.id === value ? selected : undefined}
                  onClick={() => {
                    if (option.id !== value) onSelect(option.id);
                    setOpen(false);
                  }}
                >
                  {option.label}
                  {option.id === value && <Icon name="check" size={19} />}
                </button>
              ))}
            </div>
          </Dialog>,
          document.querySelector('.app-shell') ?? document.body,
        )}
    </>
  );
}
