// Indicateurs techniques calculés sur une série de prix.
// Chaque fonction renvoie un tableau de même longueur que l'entrée,
// avec `null` tant qu'il n'y a pas assez de données pour calculer la valeur.

export type Series = (number | null)[];

/** Moyenne mobile simple : moyenne des `period` derniers prix. */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Moyenne mobile exponentielle : donne plus de poids aux prix récents.
 * EMA_t = α · prix_t + (1 − α) · EMA_{t−1}, avec α = 2 / (période + 1).
 * La première valeur est la moyenne simple des `period` premiers prix.
 */
export function ema(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (prev === null) {
      seedSum += v;
      seedCount++;
      if (seedCount === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/**
 * RSI (Relative Strength Index, Wilder) : mesure la force des hausses par rapport aux baisses, de 0 à 100.
 * RSI = 100 − 100 / (1 + RS), avec RS = moyenne des hausses / moyenne des baisses.
 * Au-dessus de 70 : actif « suracheté » ; en dessous de 30 : « survendu ».
 */
export function rsi(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiFrom(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * MACD : différence entre une EMA rapide et une EMA lente.
 * La « ligne de signal » est une EMA du MACD ; l'histogramme est leur écart.
 */
export function macd(values: number[], fast: number, slow: number, signal: number) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line: Series = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f === null || s === null ? null : f - s;
  });
  const signalLine = ema(line, signal);
  const histogram: Series = line.map((m, i) => {
    const s = signalLine[i];
    return m === null || s === null ? null : m - s;
  });
  return { macd: line, signal: signalLine, histogram };
}

/**
 * Bandes de Bollinger : moyenne mobile ± k écarts-types.
 * Environ 95 % des prix restent entre les bandes quand k = 2 (si les variations sont « normales »).
 */
export function bollinger(values: number[], period: number, k: number) {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i] as number;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (values[j] - mean) ** 2;
    const sd = Math.sqrt(sumSq / period);
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
  }
  return { middle, upper, lower };
}

/** Vrai si la série `a` passe au-dessus de `b` entre les indices i−1 et i. */
export function crossedAbove(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false;
  const [a0, a1, b0, b1] = [a[i - 1], a[i], b[i - 1], b[i]];
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
  return a0 <= b0 && a1 > b1;
}

/** Vrai si la série `a` passe en dessous de `b` entre les indices i−1 et i. */
export function crossedBelow(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false;
  const [a0, a1, b0, b1] = [a[i - 1], a[i], b[i - 1], b[i]];
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
  return a0 >= b0 && a1 < b1;
}
