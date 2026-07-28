import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  /** Rendered immediately after the number, inside the same element (e.g. 'm'). */
  suffix?: string;
  /** Decimal places. Counts are integers; durations are usually 1. */
  decimals?: number;
  className?: string;
}

const DURATION_MS = 550;

// easeOutExpo: almost all the distance is covered in the first third, so the
// number reads as *settling* on a value rather than being scrolled to it.
function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * A KPI figure that counts to its new value instead of snapping.
 *
 * On an ops dashboard that refetches every 20s this is the difference between a
 * number that silently changed while you were looking elsewhere and one whose
 * change you actually notice. The tween runs on a rAF loop writing to local
 * state — a CSS transition cannot interpolate text content.
 */
export function AnimatedNumber({ value, suffix = '', decimals = 0, className = '' }: Props) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;

    if (from === to) return;

    // Honour the OS setting: the whole point is a moving figure, so with motion
    // reduced the right answer is to show the value, not to animate it fast.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const current = from + (to - from) * easeOutExpo(t);
      setDisplay(current);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        // Land exactly on the target: the eased value only approaches it.
        fromRef.current = to;
        setDisplay(to);
        frameRef.current = 0;
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      // Adopt the target as the next tween's origin even though this one was
      // interrupted, so a value arriving mid-tween doesn't restart from stale.
      fromRef.current = value;
    };
  }, [value]);

  // er-nums (tabular figures) is not optional here — without it every frame of
  // the tween is a different width and the tile's layout jitters.
  return (
    <span className={`er-nums ${className}`}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}
