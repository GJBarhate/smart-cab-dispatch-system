import { useEffect, useState } from 'react';

/** Live "time remaining" in whole seconds until `targetIso`. Negative once past. Ticks every second, cleans up on unmount. */
export function useCountdownSeconds(targetIso) {
  const [secondsLeft, setSecondsLeft] = useState(() => targetIso ? Math.round((new Date(targetIso).getTime() - Date.now()) / 1000) : null);
  useEffect(() => {
    if (!targetIso) {
      setSecondsLeft(null);
      return;
    }
    const target = new Date(targetIso).getTime();
    const tick = () => setSecondsLeft(Math.round((target - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return secondsLeft;
}

/** Elapsed whole seconds since `sinceIso`. Ticks every second, cleans up on unmount. */
export function useElapsedSeconds(sinceIso) {
  const [elapsed, setElapsed] = useState(() => sinceIso ? Math.max(0, Math.round((Date.now() - new Date(sinceIso).getTime()) / 1000)) : null);
  useEffect(() => {
    if (!sinceIso) {
      setElapsed(null);
      return;
    }
    const since = new Date(sinceIso).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - since) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sinceIso]);
  return elapsed;
}
export function formatMinutesSeconds(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
export function formatWait(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  if (m < 1) return 'less than a minute';
  if (m === 1) return '1 minute';
  return `${m} minutes`;
}
