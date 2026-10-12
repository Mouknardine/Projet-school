import type { Bar } from '../shared/types.ts';

/** Construit des bougies de test à partir d'une liste de prix de clôture (ouverture = clôture précédente). */
export function barsFromCloses(closes: number[], start = Date.UTC(2025, 0, 6, 14, 30), stepMs = 86_400_000): Bar[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      time: start + i * stepMs,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: 1000,
    };
  });
}

export const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
