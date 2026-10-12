// Graphiques basés sur la librairie « Lightweight Charts » de TradingView.

import {
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  type DeepPartial,
  type ChartOptions,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { Bar, EquityPoint, Interval, OverlayDef, Side, TradeTrigger } from '../../../shared/types.ts';
import { fmtMoney } from '../lib/format.ts';

const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const fromTime = (t: Time) => new Date((t as number) * 1000);

const GREEN = '#34d399';
const RED = '#fb7185';

function baseOptions(intraday: boolean): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: '#94a3b8',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: 11,
      attributionLogo: true,
      panes: { separatorColor: '#1e293b', separatorHoverColor: 'rgba(148,163,184,0.15)' },
    },
    grid: { vertLines: { color: 'rgba(30,41,59,0.6)' }, horzLines: { color: 'rgba(30,41,59,0.6)' } },
    rightPriceScale: { borderColor: '#334155' },
    crosshair: { mode: CrosshairMode.Normal },
    timeScale: {
      borderColor: '#334155',
      timeVisible: intraday,
      secondsVisible: false,
      // Les heures sont affichées dans le fuseau horaire du navigateur.
      tickMarkFormatter: (time: Time, type: TickMarkType) => {
        const d = fromTime(time);
        switch (type) {
          case TickMarkType.Year:
            return String(d.getFullYear());
          case TickMarkType.Month:
            return d.toLocaleDateString('fr-CH', { month: 'short' });
          case TickMarkType.DayOfMonth:
            return d.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' });
          default:
            return d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
        }
      },
    },
    localization: {
      locale: 'fr-CH',
      timeFormatter: (time: Time) =>
        intraday
          ? fromTime(time).toLocaleString('fr-CH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
          : fromTime(time).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    },
  };
}

// ---------------------------------------------------------------------------
// Graphique des cours : chandeliers + indicateurs + achats / ventes du bot
// ---------------------------------------------------------------------------

export interface TradeMark {
  time: number;
  side: Side;
  qty: number;
  price: number;
  trigger: TradeTrigger;
}

interface PriceChartProps {
  bars: Bar[];
  overlays: OverlayDef[];
  series: Record<string, (number | null)[]>;
  trades: TradeMark[];
  interval: Interval;
  height?: number;
  /** Nombre de bougies visibles au premier affichage (sinon : tout l'historique). */
  initialBars?: number;
}

/** Associe un trade à la bougie pendant laquelle il a eu lieu. */
function barTimeFor(bars: Bar[], t: number): number | null {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? bars[found].time : null;
}

function markerFor(trade: TradeMark, barTime: number): SeriesMarker<Time> {
  const label = trade.trigger === 'stop_loss' ? 'Stop' : trade.trigger === 'take_profit' ? 'TP' : trade.side === 'BUY' ? 'Achat' : 'Vente';
  return trade.side === 'BUY'
    ? { time: toSec(barTime), position: 'belowBar', shape: 'arrowUp', color: GREEN, text: label }
    : { time: toSec(barTime), position: 'aboveBar', shape: 'arrowDown', color: RED, text: label };
}

export function PriceChart({ bars, overlays, series, trades, interval, height = 420, initialBars }: PriceChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{
    chart: IChartApi;
    candles: ISeriesApi<'Candlestick'>;
    lines: Map<string, ISeriesApi<SeriesType>>;
    markers: ISeriesMarkersPluginApi<Time>;
    fitted: boolean;
  } | null>(null);
  const latest = useRef({ bars, series, trades, overlays, initialBars });
  latest.current = { bars, series, trades, overlays, initialBars };
  const structureKey = JSON.stringify(overlays) + interval;

  const applyData = () => {
    const c = chartRef.current;
    if (!c) return;
    const { bars, series, trades, overlays, initialBars } = latest.current;
    c.candles.setData(bars.map((b) => ({ time: toSec(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    for (const ov of overlays) {
      const s = c.lines.get(ov.key);
      const values = series[ov.key];
      if (!s || !values) continue;
      s.setData(
        bars.map((b, i) => {
          const v = values[i];
          if (v === null || v === undefined) return { time: toSec(b.time) };
          if (ov.type === 'histogram') return { time: toSec(b.time), value: v, color: v >= 0 ? 'rgba(52,211,153,0.55)' : 'rgba(251,113,133,0.55)' };
          return { time: toSec(b.time), value: v };
        }),
      );
    }
    const marks = trades
      .map((t) => ({ t, barTime: barTimeFor(bars, t.time) }))
      .filter((m): m is { t: TradeMark; barTime: number } => m.barTime !== null)
      .sort((a, b) => a.barTime - b.barTime)
      .map((m) => markerFor(m.t, m.barTime));
    c.markers.setMarkers(marks);

    if (!c.fitted && bars.length > 0) {
      c.fitted = true;
      if (initialBars && bars.length > initialBars) c.chart.timeScale().setVisibleLogicalRange({ from: bars.length - initialBars, to: bars.length + 2 });
      else c.chart.timeScale().fitContent();
    }
  };

  useEffect(() => {
    if (!container.current) return;
    const intraday = interval !== '1d';
    const chart = createChart(container.current, baseOptions(intraday));
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: GREEN,
      downColor: RED,
      borderVisible: false,
      wickUpColor: GREEN,
      wickDownColor: RED,
    });
    const lines = new Map<string, ISeriesApi<SeriesType>>();
    for (const ov of latest.current.overlays) {
      const pane = ov.pane === 'price' ? 0 : 1;
      const s: ISeriesApi<SeriesType> =
        ov.type === 'histogram'
          ? chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, base: 0 }, pane)
          : chart.addSeries(
              LineSeries,
              { color: ov.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: pane === 1, crosshairMarkerVisible: false },
              pane,
            );
      for (const level of ov.levels ?? []) {
        s.createPriceLine({ price: level, color: '#64748b', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
      }
      lines.set(ov.key, s);
    }
    const panes = chart.panes();
    if (panes.length > 1) {
      panes[0].setStretchFactor(3);
      panes[1].setStretchFactor(1);
    }
    const markers = createSeriesMarkers(candles, []);
    chartRef.current = { chart, candles, lines, markers, fitted: false };
    applyData();
    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, [structureKey]);

  useEffect(applyData, [bars, series, trades]);

  return (
    <div>
      {overlays.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          {overlays.map((ov) => (
            <span key={ov.key} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ background: ov.type === 'histogram' ? '#64748b' : ov.color }} />
              {ov.label}
              {ov.pane === 'oscillator' && <span className="text-slate-500">(panneau du bas)</span>}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="text-emerald-400">▲</span> achat <span className="text-rose-400">▼</span> vente
          </span>
        </div>
      )}
      <div ref={container} style={{ height }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Courbe de performance : valeur du portefeuille vs Buy & Hold
// ---------------------------------------------------------------------------

interface EquityChartProps {
  points: EquityPoint[];
  initialCapital: number;
  currency: string;
  intraday: boolean;
  height?: number;
}

export function EquityChart({ points, initialCapital, currency, intraday, height = 300 }: EquityChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const ref = useRef<{ equity: ISeriesApi<'Baseline'>; bench: ISeriesApi<'Line'>; chart: IChartApi } | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      ...baseOptions(intraday),
      localization: {
        ...baseOptions(intraday).localization,
        priceFormatter: (p: number) => fmtMoney(p, currency, 0),
      },
    });
    const equity = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: initialCapital },
      topLineColor: GREEN,
      topFillColor1: 'rgba(52,211,153,0.28)',
      topFillColor2: 'rgba(52,211,153,0.02)',
      bottomLineColor: RED,
      bottomFillColor1: 'rgba(251,113,133,0.02)',
      bottomFillColor2: 'rgba(251,113,133,0.28)',
      lineWidth: 2,
      priceLineVisible: false,
    });
    equity.createPriceLine({ price: initialCapital, color: '#475569', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: 'Capital initial' });
    const bench = chart.addSeries(LineSeries, {
      color: '#94a3b8',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    ref.current = { chart, equity, bench };
    return () => {
      ref.current = null;
      chart.remove();
    };
  }, [initialCapital, currency, intraday]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // Les temps doivent être strictement croissants : on garde un point par seconde.
    const unique: EquityPoint[] = [];
    for (const p of points) {
      if (unique.length && toSec(unique[unique.length - 1].time) === toSec(p.time)) unique[unique.length - 1] = p;
      else unique.push(p);
    }
    c.equity.setData(unique.map((p) => ({ time: toSec(p.time), value: p.equity })));
    c.bench.setData(unique.filter((p) => p.benchmark !== null).map((p) => ({ time: toSec(p.time), value: p.benchmark as number })));
    c.chart.timeScale().fitContent();
  }, [points, initialCapital, currency, intraday]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-emerald-400" /> Bot
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t border-dashed border-slate-400" /> Buy & Hold (mêmes actions, achetées au départ)
        </span>
      </div>
      <div ref={container} style={{ height }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini-courbe pour les cartes
// ---------------------------------------------------------------------------

export function Sparkline({ values, base, className }: { values: number[]; base: number; className?: string }) {
  if (values.length < 2) return <div className={className} />;
  const w = 120;
  const h = 36;
  const min = Math.min(...values, base);
  const max = Math.max(...values, base);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * (h - 4) - 2;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = values[values.length - 1] >= base;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2={w} y1={y(base)} y2={y(base)} stroke="#334155" strokeDasharray="3 3" strokeWidth="1" />
      <path d={d} fill="none" stroke={up ? GREEN : RED} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
