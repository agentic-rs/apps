/** Portaled dialogs and their programmatic focus transfers inherit the opening interaction. */
export function trackFocusInput() {
  const root = document.documentElement;
  const listeners = new AbortController();
  const options = { capture: true, signal: listeners.signal };
  let pointer_down = false;
  document.addEventListener(
    'pointerdown',
    () => {
      pointer_down = true;
      root.dataset.focusInput = 'pointer';
    },
    options,
  );
  document.addEventListener(
    'pointercancel',
    () => {
      pointer_down = false;
    },
    options,
  );
  document.addEventListener(
    'keydown',
    () => {
      pointer_down = false;
      root.dataset.focusInput = 'keyboard';
    },
    options,
  );
  document.addEventListener(
    'click',
    (event) => {
      // An assistive activation may have no pointer sequence or keyboard event.
      // Leave its focus cue to the browser.
      if (event.isTrusted && event.detail > 0) root.dataset.focusInput = 'pointer';
      else if (!pointer_down && event.detail === 0 && root.dataset.focusInput === 'pointer')
        delete root.dataset.focusInput;
      pointer_down = false;
    },
    options,
  );
  return () => {
    listeners.abort();
    delete root.dataset.focusInput;
  };
}
