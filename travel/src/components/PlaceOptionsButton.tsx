import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export function PlaceOptionsButton<T extends string | undefined>({
  title,
  label = title,
  icon,
  options,
  value,
  disabled,
  onSelect,
}: {
  title: string;
  label?: string;
  icon: 'filter' | 'sort';
  options: readonly { id: T; label: string }[];
  value: T;
  disabled?: boolean;
  onSelect(value: T): void;
}) {
  const [open, setOpen] = useState(false);
  const selected = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restore_focus = useRef(false);
  useLayoutEffect(() => {
    if (open) selected.current?.focus();
    else if (restore_focus.current) {
      trigger.current?.focus({ preventScroll: true });
      restore_focus.current = false;
    }
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="place-options-trigger"
        data-active={options[0]?.id === value ? undefined : ''}
        aria-label={label}
        aria-description={options.find((option) => option.id === value)?.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => {
          restore_focus.current = true;
          setOpen(true);
        }}
      >
        <Icon name={icon} size={20} />
      </button>
      {open &&
        createPortal(
          <Dialog title={title} onDismiss={() => setOpen(false)}>
            <div className="place-options-list" role="group" aria-label={title}>
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
