import { useEffect, type RefObject } from 'react';

export function usePlaceSearchViewport(input: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const field = input.current;
    const search = field?.closest<HTMLElement>('.stop-picker-search');
    const viewport = field?.closest<HTMLElement>('.stop-picker-scroll');
    if (!field || !search || !viewport) return;
    const reveal = () => {
      if (document.activeElement !== field || getComputedStyle(viewport).overflowY !== 'auto')
        return;
      // Only the compact stacked picker scrolls its search and results together.
      const top = search.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      viewport.scrollTop += top - 4;
    };
    const resize = new ResizeObserver(reveal);
    resize.observe(viewport);
    field.addEventListener('focus', reveal);
    return () => {
      resize.disconnect();
      field.removeEventListener('focus', reveal);
    };
  }, [input]);
}
