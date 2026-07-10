export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const CONFIG = { size: 8, animate: true };

const helper = () => 42;

export type Cell = { v: number };
