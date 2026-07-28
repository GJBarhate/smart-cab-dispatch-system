/**
 * Drives the pointer-tracked highlight on `.er-spotlight` cards.
 *
 * One delegated listener on the document rather than a handler per card: an ops
 * dashboard can hold a few dozen panels at once, and this way the cost is fixed
 * no matter how many are mounted. Nothing here touches React state — the
 * highlight is three CSS custom properties written straight to the node, so
 * moving the pointer across a live cost matrix re-renders nothing.
 */

// Writes are coalesced into one rAF: pointermove fires well above display
// refresh rate on a high-polling-rate mouse, and only the last position of a
// frame is ever visible.
let frame = 0;
let pending: { el: HTMLElement; x: number; y: number } | null = null;
let active: HTMLElement | null = null;

function flush(): void {
  frame = 0;
  if (!pending) return;
  const { el, x, y } = pending;
  pending = null;

  const rect = el.getBoundingClientRect();
  // The pointer can leave between the event and this frame; a stale write would
  // strand the highlight lit at the edge of a card the user has left.
  if (rect.width === 0 || rect.height === 0) return;

  el.style.setProperty('--mx', `${((x - rect.left) / rect.width) * 100}%`);
  el.style.setProperty('--my', `${((y - rect.top) / rect.height) * 100}%`);
  el.style.setProperty('--spot', '1');
}

function clear(el: HTMLElement): void {
  el.style.setProperty('--spot', '0');
}

function onPointerMove(e: PointerEvent): void {
  // Touch would light a card up and leave it lit, with no pointerleave to
  // follow — the effect is meaningless without a hovering cursor.
  if (e.pointerType !== 'mouse') return;

  const target = e.target instanceof Element ? e.target.closest<HTMLElement>('.er-spotlight') : null;

  if (target !== active) {
    if (active) clear(active);
    active = target;
  }
  if (!target) return;

  pending = { el: target, x: e.clientX, y: e.clientY };
  if (!frame) frame = requestAnimationFrame(flush);
}

function onPointerLeave(): void {
  // Pointer left the window entirely; without this the last card stays lit.
  if (active) {
    clear(active);
    active = null;
  }
  pending = null;
}

/**
 * Starts the effect. Returns a teardown so a caller can stop it; the app calls
 * this once at boot and never tears it down.
 */
export function initSpotlight(): () => void {
  // Respect the OS setting at the source rather than only hiding the result in
  // CSS — with this off, no listener runs and no style is ever written.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return () => undefined;
  }

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);

  return () => {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerleave', onPointerLeave);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    if (active) clear(active);
    active = null;
  };
}
