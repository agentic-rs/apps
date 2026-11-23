import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { planned_place_radius_km } from '../lib/place-providers';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import '../search-area.css';

const city_center = { id: undefined, title: 'City center', detail: '' };

export function SearchAreaButton({
  options,
  selected_id,
  onSelect,
  disabled,
}: {
  options: readonly { id: string; title: string; detail: string }[];
  selected_id?: string;
  onSelect(id?: string): void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current_option = useRef<HTMLButtonElement>(null);
  const restore_focus = useRef(false);
  const description = useId();
  const selected = options.find((area) => area.id === selected_id) ?? city_center;
  useLayoutEffect(() => {
    if (open) current_option.current?.focus();
    else if (restore_focus.current) {
      trigger.current?.focus({ preventScroll: true });
      restore_focus.current = false;
    }
  }, [open]);

  function optionButton(area: { id?: string; title: string; detail: string }) {
    const checked = area.id === selected.id;
    return (
      <button
        key={area.id}
        ref={checked ? current_option : undefined}
        type="button"
        aria-label={area.title}
        aria-description={area.detail || undefined}
        aria-pressed={checked}
        onClick={() => {
          if (area.id !== selected_id) onSelect(area.id);
          setOpen(false);
        }}
      >
        <span>
          <strong>{area.title}</strong>
          {area.detail && <small>{area.detail}</small>}
        </span>
        {checked && <Icon name="check" size={19} />}
      </button>
    );
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="search-area-trigger"
        aria-label="Search area"
        aria-describedby={description}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          restore_focus.current = true;
          setOpen(true);
        }}
      >
        <Icon name="locate" size={16} />
        <span className="search-area-name">
          <span>Search near</span> <strong id={description}>{selected.title}</strong>
        </span>
        <Icon name="next" size={14} />
      </button>
      {open &&
        createPortal(
          <Dialog title="Search area" onDismiss={() => setOpen(false)}>
            <div className="search-area-options" role="group" aria-label="Search area">
              {optionButton(city_center)}
              <h3>Within {planned_place_radius_km} km of a planned place</h3>
              {options.map(optionButton)}
            </div>
          </Dialog>,
          document.querySelector('.app-shell') ?? document.body,
        )}
    </>
  );
}
