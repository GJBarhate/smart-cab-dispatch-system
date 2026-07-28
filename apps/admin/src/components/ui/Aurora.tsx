import { type ReactNode, useCallback, useRef } from 'react';

/**
 * Drifting gradient backdrop. Purely decorative, so it is `aria-hidden` and
 * carries no text — a screen reader should never announce it.
 *
 * The blobs and their motion live in index.css (`.er-aurora` / `.er-blob`);
 * this component only places them, so the whole effect is one compositor-layer
 * animation with no React re-render involved.
 */
export function Aurora() {
  return (
    <div className="er-aurora" aria-hidden="true">
      <div className="er-blob er-blob-1" />
      <div className="er-blob er-blob-2" />
      <div className="er-blob er-blob-3" />
    </div>
  );
}

const MAX_TILT_DEG = 7;

/**
 * A card that tilts in 3D toward the pointer, with a sheen that tracks it.
 *
 * Written straight to CSS custom properties on the node rather than through
 * React state: a `setState` per `pointermove` would re-render the whole subtree
 * (including the form and its inputs) at pointer frequency. Touch is
 * deliberately not wired up — a finger is already on the card it would tilt,
 * and phones get the sheen-free flat version.
 */
export function TiltCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const node = ref.current;
    if (!node) return;

    // Coalesce to one write per frame; pointermove can fire well above 60Hz on
    // a high-polling-rate mouse.
    if (frame.current) cancelAnimationFrame(frame.current);
    const { clientX, clientY } = e;
    frame.current = requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width;
      const py = (clientY - rect.top) / rect.height;
      node.style.setProperty('--ry', `${(px - 0.5) * 2 * MAX_TILT_DEG}deg`);
      node.style.setProperty('--rx', `${(0.5 - py) * 2 * MAX_TILT_DEG}deg`);
      node.style.setProperty('--mx', `${px * 100}%`);
      node.style.setProperty('--my', `${py * 100}%`);
      node.style.setProperty('--sheen', '1');
    });
  }, []);

  const onPointerLeave = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    node.style.setProperty('--rx', '0deg');
    node.style.setProperty('--ry', '0deg');
    node.style.setProperty('--sheen', '0');
  }, []);

  return (
    <div className="er-tilt-scene">
      <div
        ref={ref}
        className={`er-tilt relative ${className}`}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        {children}
        <span className="er-tilt-sheen" aria-hidden="true" />
      </div>
    </div>
  );
}
