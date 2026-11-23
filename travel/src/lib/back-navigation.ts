import { useLayoutEffect, useRef } from 'react';

// Apell asks the applet once. Presentations register in opening order, so closing
// a photo or confirmation reveals the editor or tool that was already beneath it.
const layers = new Set<() => void>();

export function useBackLayer(open: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  useLayoutEffect(() => {
    latest.current = onBack;
  });
  useLayoutEffect(() => {
    if (!open) return;
    const back = () => latest.current();
    layers.add(back);
    return () => {
      layers.delete(back);
    };
  }, [open]);
}

export function dismissBackLayer(): boolean {
  const back = [...layers].at(-1);
  if (!back) return false;
  back();
  return true;
}
