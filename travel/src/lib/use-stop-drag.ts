import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

function verticalScroller(list: HTMLElement): HTMLElement | null {
  for (let element: HTMLElement | null = list; element; element = element.parentElement) {
    if (
      element.scrollHeight > element.clientHeight &&
      /auto|scroll|overlay/.test(getComputedStyle(element).overflowY)
    )
      return element;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

/** Pixels per second. The edge zones stay separate even in a short list viewport. */
export function stopDragScrollSpeed(pointer_y: number, top: number, bottom: number): number {
  const edge = Math.min(48, (bottom - top) / 3);
  if (edge <= 0) return 0;
  if (pointer_y < top + edge) return -720 * Math.min(1, (top + edge - pointer_y) / edge);
  if (pointer_y > bottom - edge) return 720 * Math.min(1, (pointer_y - bottom + edge) / edge);
  return 0;
}

/** Attach list_ref to the list and data-stop-id to each direct child row. */
export function useStopDrag(ids: readonly string[], onReorder: (order: string[]) => void) {
  const list_ref = useRef<HTMLOListElement>(null);
  const [dragging_id, setDraggingId] = useState<string | null>(null);
  const active = useRef<((restore: boolean, unmount?: boolean) => void) | null>(null);
  const align_row = useRef<(() => void) | null>(null);
  const click_block = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    // A keyed row may now occupy a new slot. Correct its offset before paint.
    align_row.current?.();
  }, [ids, dragging_id]);
  useEffect(
    () => () => {
      active.current?.(false, true);
      click_block.current?.abort();
    },
    [],
  );

  function cancelDrag() {
    if (!active.current) return false;
    active.current(true);
    return true;
  }

  function start(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (!list_ref.current || active.current || !event.isPrimary || event.button !== 0) return;
    const list = list_ref.current;
    const initial = [...ids];
    let slot = initial.indexOf(id);
    if (slot < 0) return;
    const peers = initial.filter((item) => item !== id);
    const handle = event.currentTarget;
    const row = handle.closest<HTMLElement>('[data-stop-id]');
    if (!row || row.parentElement !== list || row.dataset.stopId !== id) return;
    const pointer_id = event.pointerId;
    const start_x = event.clientX;
    const start_y = event.clientY;
    const grab_offset = start_y - row.getBoundingClientRect().top;
    const scroll = verticalScroller(list);
    const listeners = new AbortController();
    const { signal } = listeners;
    let pointer_y = start_y;
    let dragging = false;
    let capture: HTMLElement = handle;
    let frame = 0;
    let last_frame = 0;

    function passedThreshold(e: PointerEvent) {
      return Math.hypot(e.clientX - start_x, e.clientY - start_y) >= 5;
    }

    const align = () => {
      row.style.setProperty('--stop-drag-y', '0px');
      const natural = row.getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      // A translated last row must not extend the scrollable area past the list.
      const top = Math.max(
        bounds.top,
        Math.min(pointer_y - grab_offset, bounds.bottom - natural.height),
      );
      row.style.setProperty('--stop-drag-y', `${top - natural.top}px`);
    };

    function place() {
      align();
      let next = peers.length;
      for (const row of list.children) {
        if (!(row instanceof HTMLElement) || !row.dataset.stopId || row.dataset.stopId === id)
          continue;
        const bounds = row.getBoundingClientRect();
        if (pointer_y < (bounds.top + bounds.bottom) / 2) {
          next = peers.indexOf(row.dataset.stopId);
          break;
        }
      }
      if (next < 0 || next === slot) return;
      slot = next;
      const order = [...peers];
      order.splice(slot, 0, id);
      onReorder(order);
    }

    function autoScroll(time: number) {
      frame = 0;
      if (!scroll) return;
      const bounds = scroll.getBoundingClientRect();
      const top = scroll === document.scrollingElement ? 0 : Math.max(0, bounds.top);
      const bottom =
        scroll === document.scrollingElement
          ? window.innerHeight
          : Math.min(window.innerHeight, bounds.bottom);
      const speed = stopDragScrollSpeed(pointer_y, top, bottom);
      const elapsed = Math.min(32, time - last_frame);
      last_frame = time;
      if (!speed) return;
      const previous = scroll.scrollTop;
      scroll.scrollTop += Math.sign(speed) * Math.max(1, (Math.abs(speed) * elapsed) / 1_000);
      if (scroll.scrollTop === previous) return;
      place();
      frame = requestAnimationFrame(autoScroll);
    }

    function move(e: PointerEvent) {
      if (e.pointerId !== pointer_id) return;
      pointer_y = e.clientY;
      if (!dragging) {
        if (!passedThreshold(e)) return;
        dragging = true;
        // Keep capture on a connected element while React moves the keyed rows.
        capture = list;
        capture.setPointerCapture(pointer_id);
        align_row.current = align;
        setDraggingId(id);
      }
      e.preventDefault();
      place();
      if (!frame && scroll) {
        last_frame = performance.now();
        frame = requestAnimationFrame(autoScroll);
      }
    }

    function finish(restore: boolean, unmount = false) {
      active.current = null;
      align_row.current = null;
      row!.style.removeProperty('--stop-drag-y');
      listeners.abort();
      cancelAnimationFrame(frame);
      if (capture.hasPointerCapture(pointer_id)) capture.releasePointerCapture(pointer_id);
      if (!dragging || unmount) return;
      if (restore && slot !== initial.indexOf(id)) onReorder(initial);
      setDraggingId(null);
      // A drop can dispatch a click after pointerup, including after Escape.
      // The next physical press starts a fresh gesture, as does a keyboard click.
      const block = new AbortController();
      click_block.current?.abort();
      click_block.current = block;
      list.addEventListener(
        'click',
        (e) => {
          if (e.detail > 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          block.abort();
        },
        { capture: true, signal: block.signal },
      );
      window.addEventListener('pointerdown', () => block.abort(), {
        capture: true,
        signal: block.signal,
      });
    }

    handle.setPointerCapture(pointer_id);
    active.current = finish;
    window.addEventListener('pointermove', move, { passive: false, signal });
    window.addEventListener(
      'pointerup',
      (e) => {
        if (e.pointerId !== pointer_id) return;
        // WebKit may deliver a fast flick's destination with no intervening pointermove.
        if (!dragging && passedThreshold(e)) dragging = true;
        if (dragging) {
          pointer_y = e.clientY;
          place();
        }
        finish(false);
      },
      { signal },
    );
    window.addEventListener(
      'pointercancel',
      (e) => {
        if (e.pointerId === pointer_id) finish(true);
      },
      { signal },
    );
    window.addEventListener(
      'lostpointercapture',
      (e) => {
        if (e.pointerId === pointer_id && e.target === capture) finish(true);
      },
      { signal },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      },
      { capture: true, signal },
    );
    window.addEventListener('blur', () => finish(true), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) finish(true);
      },
      { signal },
    );
  }

  function handleProps(id: string) {
    return { onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => start(event, id) };
  }

  return { list_ref, dragging_id, handleProps, cancelDrag };
}
