import React, { type ReactNode, useCallback, useRef } from 'react';

/**
 * Drifting gradient backdrop. Purely decorative, so it is `aria-hidden` and
 * carries no text.
 *
 * The blobs and their motion live in index.css (`.er-aurora` / `.er-blob`);
 * this component only places them, so the effect runs entirely on the
 * compositor with no React re-render involved — which is what keeps it off the
 * battery budget on a phone.
 */
export function Aurora(): JSX.Element {
  return (
    <div className="er-aurora" aria-hidden="true">
      <div className="er-blob er-blob-1" />
      <div className="er-blob er-blob-2" />
      <div className="er-blob er-blob-3" />
    </div>
  );
}

const MAX_TILT_DEG = 6;

/**
 * A card that tilts in 3D toward a mouse pointer, with a sheen that tracks it.
 *
 * Values are written straight to CSS custom properties rather than React state:
 * a `setState` per `pointermove` would re-render the sign-in form at pointer
 * frequency. Touch pointers are ignored — a finger is already covering the card
 * it would tilt — so phones get the flat version and pay nothing for this.
 */
export function TiltCard({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const node = ref.current;
    if (!node) return;

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
