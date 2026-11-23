import { useRef } from 'react';
import { confirmsInput } from '../lib/keyboard';
import { Icon } from './Icon';

export function SearchField({
  label,
  placeholder,
  clear_label,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  clear_label: string;
  value: string;
  onChange(value: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div role="search" className="search-box filter-search">
      <Icon name="search" size={18} />
      <input
        ref={input}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        value={value}
        onKeyDown={(event) => {
          if (confirmsInput(event.nativeEvent)) event.currentTarget.blur();
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className="icon-button"
          aria-label={clear_label}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}
