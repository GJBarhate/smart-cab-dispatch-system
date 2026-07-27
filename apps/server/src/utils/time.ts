export const now = (): Date => new Date();

export const addMinutes = (date: Date, minutes: number): Date => new Date(date.getTime() + minutes * 60_000);

export const addSeconds = (date: Date, seconds: number): Date => new Date(date.getTime() + seconds * 1000);

export const minutesBetween = (a: Date, b: Date): number => (b.getTime() - a.getTime()) / 60_000;

export const secondsBetween = (a: Date, b: Date): number => (b.getTime() - a.getTime()) / 1000;

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export const isBetween = (date: Date, start: Date, end: Date): boolean =>
  date.getTime() >= start.getTime() && date.getTime() < end.getTime();
