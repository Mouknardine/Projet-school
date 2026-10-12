// Source de données de marché : Yahoo Finance (gratuit, sans clé API).
// Fournit les cours réels (actions US, suisses, européennes, ETF, cryptos) sous forme de bougies.
// Selon la bourse, les cours peuvent être différés d'environ 15 minutes.

import type { Bar, Interval, Quote, SymbolSearchResult } from '../../shared/types.ts';

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const YAHOO_INTERVAL: Record<Interval, string> = { '5m': '5m', '15m': '15m', '1h': '60m', '1d': '1d' };

export const INTERVAL_MS: Record<Interval, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/** Nombre approximatif de jours de bourse couverts par chaque plage Yahoo. */
const RANGE_TRADING_DAYS: Record<string, number> = {
  '5d': 5,
  '1mo': 21,
  '3mo': 63,
  '6mo': 126,
  '1y': 252,
  '2y': 504,
  '5y': 1260,
  '10y': 2520,
};

const BARS_PER_DAY: Record<Interval, number> = { '5m': 78, '15m': 26, '1h': 7, '1d': 1 };

/** Plages disponibles pour chaque unité de temps (Yahoo limite l'historique intraday). */
export const RANGES: Record<Interval, string[]> = {
  '5m': ['5d', '1mo'],
  '15m': ['5d', '1mo'],
  '1h': ['1mo', '3mo', '6mo', '1y'],
  '1d': ['6mo', '1y', '2y', '5y', '10y'],
};

export const RANGE_LABELS: Record<string, string> = {
  '5d': '5 jours',
  '1mo': '1 mois',
  '3mo': '3 mois',
  '6mo': '6 mois',
  '1y': '1 an',
  '2y': '2 ans',
  '5y': '5 ans',
  '10y': '10 ans',
};

/** Choisit la plus petite plage d'historique contenant au moins `minBars` bougies. */
export function rangeFor(interval: Interval, minBars: number): string {
  const ranges = RANGES[interval];
  for (const r of ranges) {
    if (RANGE_TRADING_DAYS[r] * BARS_PER_DAY[interval] >= minBars * 1.2 + 10) return r;
  }
  return ranges[ranges.length - 1];
}

export class MarketDataError extends Error {}

export interface ChartData {
  quote: Quote;
  bars: Bar[];
}

async function getJson(path: string): Promise<any> {
  let lastError: unknown;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      // Yahoo répond 404 avec un message d'erreur JSON quand le symbole n'existe pas.
      if (res.status === 404) return await res.json().catch(() => null);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new MarketDataError(`Yahoo Finance injoignable (${msg})`);
}

/** Transforme la réponse brute de Yahoo en bougies propres + informations de cotation. */
export function parseChart(json: any, now = Date.now()): ChartData {
  const result = json?.chart?.result?.[0];
  if (!result) {
    const desc = json?.chart?.error?.description;
    throw new MarketDataError(desc ? `Symbole introuvable : ${desc}` : 'Symbole introuvable');
  }
  const meta = result.meta ?? {};
  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};

  const byTime = new Map<number, Bar>();
  timestamps.forEach((t, i) => {
    const bar: Bar = {
      time: t * 1000,
      open: q.open?.[i],
      high: q.high?.[i],
      low: q.low?.[i],
      close: q.close?.[i],
      volume: q.volume?.[i] ?? 0,
    };
    if ([bar.open, bar.high, bar.low, bar.close].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      byTime.set(bar.time, bar);
    }
  });
  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);

  const last = bars[bars.length - 1];
  const price: number | undefined = meta.regularMarketPrice ?? last?.close;
  if (price === undefined) throw new MarketDataError(`Aucun cours disponible pour ${meta.symbol ?? 'ce symbole'}`);
  const priceTime = (meta.regularMarketTime ?? (last ? last.time / 1000 : now / 1000)) * 1000;

  // Clôture de la veille : dernière bougie d'un jour de bourse antérieur à celui de la dernière bougie.
  const offset = (meta.gmtoffset ?? 0) * 1000;
  const dayOf = (t: number) => Math.floor((t + offset) / 86_400_000);
  let previousClose: number | null = meta.chartPreviousClose ?? meta.previousClose ?? null;
  if (last) {
    const lastDay = dayOf(last.time);
    for (let i = bars.length - 2; i >= 0; i--) {
      if (dayOf(bars[i].time) < lastDay) {
        previousClose = bars[i].close;
        break;
      }
    }
  }

  // Le marché est ouvert si l'heure actuelle est dans la séance régulière ET que le cours est récent.
  const period = meta.currentTradingPeriod?.regular;
  const inSession = period ? now >= period.start * 1000 && now < period.end * 1000 : false;
  const marketOpen = inSession && now - priceTime < 45 * 60_000;

  return {
    quote: {
      symbol: meta.symbol ?? '',
      name: meta.longName ?? meta.shortName ?? meta.symbol ?? '',
      currency: (meta.currency ?? 'USD').toUpperCase(),
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
      price,
      priceTime,
      previousClose,
      marketOpen,
    },
    bars,
  };
}

const cache = new Map<string, { at: number; promise: Promise<ChartData> }>();

/** Récupère l'historique de bougies d'un symbole (avec un petit cache pour ne pas surcharger Yahoo). */
export function getChart(symbol: string, interval: Interval, range: string): Promise<ChartData> {
  const key = `${symbol}|${interval}|${range}`;
  const ttl = interval === '1d' ? 60_000 : 15_000;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;

  const path =
    `/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${YAHOO_INTERVAL[interval]}&range=${range}&includePrePost=false&events=div%2Csplits`;
  const promise = getJson(path).then((json) => parseChart(json));
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

/** Cours actuel d'un symbole. */
export async function getQuote(symbol: string): Promise<Quote> {
  return (await getChart(symbol, '1d', '5d')).quote;
}

/** Recherche de symboles par nom (ex. « nestle » → NESN.SW). */
export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const path =
    `/v1/finance/search?q=${encodeURIComponent(query)}` + '&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false';
  const json = await getJson(path);
  const allowed = new Set(['EQUITY', 'ETF', 'CRYPTOCURRENCY']);
  return (json?.quotes ?? [])
    .filter((q: any) => q?.symbol && allowed.has(q.quoteType))
    .map((q: any) => ({
      symbol: q.symbol,
      name: q.longname ?? q.shortname ?? q.symbol,
      exchange: q.exchDisp ?? q.exchange ?? '',
      type: q.typeDisp ?? q.quoteType,
    }));
}

/**
 * Sépare les bougies terminées de la bougie en cours de formation.
 * Le bot ne prend ses décisions que sur des bougies clôturées (sinon le signal pourrait changer avant la fin).
 */
export function closedBars(bars: Bar[], interval: Interval, marketOpen: boolean, now = Date.now()): Bar[] {
  if (!marketOpen || bars.length === 0) return bars;
  const last = bars[bars.length - 1];
  return last.time + INTERVAL_MS[interval] > now ? bars.slice(0, -1) : bars;
}
