import { useRef, type ReactNode } from 'react';

/** Apell's opaque iframe disallows browser form submission, including implicit Enter submits. */
export function EditorForm({
  children,
  onSave,
  onChange,
}: {
  children(save: () => void): ReactNode;
  onSave(): Promise<void>;
  onChange?: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  function save() {
    if (ref.current?.reportValidity()) void onSave();
  }
  return (
    <form
      ref={ref}
      onChange={onChange}
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          !event.nativeEvent.isComposing &&
          event.target instanceof HTMLInputElement &&
          !['checkbox', 'file', 'button', 'submit'].includes(event.target.type)
        ) {
          event.preventDefault();
          save();
        }
      }}
    >
      {children(save)}
    </form>
  );
}
