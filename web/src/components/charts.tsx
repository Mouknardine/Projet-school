// Graphiques : chandeliers (TradingView Lightweight Charts) et visualisations SVG sur mesure.

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { Table2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Bar, EquityPoint, Interval, OverlayDef, Side, TradeTrigger } from '../../../shared/types.ts';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format.ts';
import { cx, Delta, Segmented } from './ui.tsx';

export const COLORS = {
  surface: '#141416',
  line: '#26262a',
  grid: '#1f1f23',
  ink: '#f0efec',
  ink2: '#c3c2b7',
  ink3: '#898781',
  accent: '#3987e5',
  up: '#2ebd85',
  down: '#f6465d',
  bench: '#7d7c76',
  cash: '#3a3a40',
};

/** Couleurs des séries, dans un ordre fixe : une action garde toujours la même couleur. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const fromTime = (t: Time) => new Date((t as number) * 1000);

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Graduations « rondes » pour un axe (1, 2, 2.5, 5 × 10ⁿ). */
function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${fmtNum(v / 1e6, 2)} M`;
  if (a >= 1e4) return fmtNum(v, 0);
  if (a >= 100) return fmtNum(v, 0);
  return fmtNum(v, 2);
}

// ---------------------------------------------------------------------------
// Courbe de performance : valeur du portefeuille vs Buy & Hold + drawdown
// ---------------------------------------------------------------------------

export interface RangeOption {
  id: string;
  label: string;
  /** Durée affichée en millisecondes (null = tout l'historique). */
  ms: number | null;
}

export const LIVE_RANGES: RangeOption[] = [
  { id: '1d', label: '1 jour', ms: 86_400_000 },
  { id: '1w', label: '1 semaine', ms: 7 * 86_400_000 },
  { id: '1m', label: '1 mois', ms: 30 * 86_400_000 },
  { id: 'all', label: 'Tout', ms: null },
];

interface PerformanceChartProps {
  points: EquityPoint[];
  initialCapital: number;
  currency: string;
  title?: string;
  ranges?: RangeOption[];
  height?: number;
}

const PAD = { top: 10, right: 76, bottom: 26, left: 2 };

export function PerformanceChart({ points, initialCapital, currency, title = 'Valeur du portefeuille', ranges = LIVE_RANGES, height = 300 }: PerformanceChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [rangeId, setRangeId] = useState(ranges[ranges.length - 1]?.id ?? 'all');
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const uid = useId().replace(/:/g, '');

  // Drawdown calculé sur tout l'historique (le sommet peut être avant la période affichée).
  const allDrawdowns = useMemo(() => {
    let peak = -Infinity;
    return points.map((p) => {
      peak = Math.max(peak, p.equity);
      return peak > 0 ? ((p.equity - peak) / peak) * 100 : 0;
    });
  }, [points]);

  const { view, drawdowns } = useMemo(() => {
    const range = ranges.find((r) => r.id === rangeId);
    let start = 0;
    if (range?.ms && points.length) {
      const from = points[points.length - 1].time - range.ms;
      start = points.findIndex((p) => p.time >= from);
      if (start < 0 || points.length - start < 2) start = Math.max(0, points.length - 2);
    }
    return { view: points.slice(start), drawdowns: allDrawdowns.slice(start) };
  }, [points, allDrawdowns, rangeId, ranges]);

  const n = view.length;
  const spanMs = n > 1 ? view[n - 1].time - view[0].time : 0;
  const intraday = spanMs < 3 * 86_400_000;

  const w = Math.max(width, 280);
  const h = height;
  const x0 = PAD.left;
  const x1 = w - PAD.right;
  const ddH = (h - PAD.top - PAD.bottom) * 0.22;
  const gap = 16;
  const yTop = PAD.top;
  const yBottom = h - PAD.bottom - ddH - gap;
  const ddTop = h - PAD.bottom - ddH;

  const [lo, hi] = useMemo(() => {
    let a = initialCapital;
    let b = initialCapital;
    for (const p of view) {
      a = Math.min(a, p.equity, p.benchmark ?? p.equity);
      b = Math.max(b, p.equity, p.benchmark ?? p.equity);
    }
    const pad = (b - a) * 0.12 || b * 0.002 || 1;
    return [a - pad, b + pad];
  }, [view, initialCapital]);

  const maxDd = Math.min(0, ...drawdowns);
  const x = (i: number) => (n <= 1 ? x0 : x0 + (i / (n - 1)) * (x1 - x0));
  const y = (v: number) => yBottom - ((v - lo) / (hi - lo || 1)) * (yBottom - yTop);
  const yDd = (v: number) => ddTop + (Math.abs(v) / Math.max(0.01, Math.abs(maxDd))) * ddH;

  const linePath = (vals: (number | null)[], fy: (v: number) => number) => {
    let d = '';
    vals.forEach((v, i) => {
      if (v === null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${fy(v).toFixed(1)}`;
    });
    return d;
  };
  const equityPath = linePath(view.map((p) => p.equity), y);
  const benchPath = linePath(view.map((p) => p.benchmark), y);
  const ddLine = linePath(drawdowns, yDd);
  const ticks = niceTicks(lo, hi, 4).filter((t) => y(t) >= yTop - 1 && y(t) <= yBottom + 1);

  const timeTicks = useMemo(() => {
    if (n < 2) return [];
    const want = Math.max(2, Math.min(6, Math.floor((x1 - x0) / 110)));
    const out: number[] = [];
    for (let k = 0; k < want; k++) out.push(Math.round((k / (want - 1)) * (n - 1)));
    return [...new Set(out)];
  }, [n, x1, x0]);

  const fmtTick = (t: number) =>
    intraday
      ? new Date(t).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })
      : spanMs > 120 * 86_400_000
        ? new Date(t).toLocaleDateString('fr-CH', { month: 'short', year: '2-digit' })
        : new Date(t).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' });
  const fmtFull = (t: number) =>
    new Date(t).toLocaleString('fr-CH', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const active = hover !== null ? view[hover] : view[n - 1];
  const activeDd = hover !== null ? drawdowns[hover] : drawdowns[n - 1];
  const pnl = active ? active.equity - initialCapital : 0;
  const pnlPct = (pnl / initialCapital) * 100;
  const benchPct = active?.benchmark != null ? (active.benchmark / initialCapital - 1) * 100 : null;

  const onMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || n < 2) return;
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * w;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - x0) / (x1 - x0)) * (n - 1)))));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setHover((cur) => {
      const base = cur ?? n - 1;
      return Math.max(0, Math.min(n - 1, base + (e.key === 'ArrowLeft' ? -1 : 1)));
    });
  };

  const tableRows = useMemo(() => {
    const step = Math.max(1, Math.ceil(view.length / 60));
    return view.map((p, i) => ({ p, dd: drawdowns[i] })).filter((_, i) => i % step === 0 || i === view.length - 1).reverse();
  }, [view, drawdowns]);

  return (
    <div ref={wrapRef} className="w-full">
      {/* Lecture : valeur, performance, comparaison (suit le curseur) */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
            {title}
            <span className="text-ink-3/70">·</span>
            <span>{active ? (hover !== null ? fmtFull(active.time) : 'maintenant') : ''}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{active ? fmtMoney(active.equity, currency) : '–'}</span>
            <Delta value={pnlPct} size="md" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
            <span>
              <span className={pnl >= 0 ? 'text-up' : 'text-down'}>
                {pnl >= 0 ? '+' : '−'}
                {fmtMoney(Math.abs(pnl), currency)}
              </span>{' '}
              depuis le départ
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: COLORS.bench }} />
              Acheter et garder <span className="text-ink-2">{active?.benchmark != null ? fmtMoney(active.benchmark, currency) : '–'}</span>
              <span>({fmtPct(benchPct)})</span>
            </span>
            <span>
              Chute depuis le sommet <span className={activeDd < -0.005 ? 'text-down' : 'text-ink-2'}>{fmtNum(activeDd ?? 0)} %</span>
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ranges.length > 1 && <Segmented value={rangeId} onChange={setRangeId} items={ranges.map((r) => ({ id: r.id, label: r.label }))} />}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className={cx(
              'inline-flex h-[30px] items-center gap-1 rounded-lg border border-line px-2 text-xs font-medium transition-colors [&_svg]:size-3.5',
              showTable ? 'bg-raised text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
            aria-pressed={showTable}
          >
            <Table2 aria-hidden /> Voir en tableau
          </button>
        </div>
      </div>

      {n < 2 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-line text-sm text-ink-3" style={{ height }}>
          La courbe apparaîtra après les premières analyses du bot.
        </div>
      ) : showTable ? (
        <div className="relative max-h-[320px] overflow-auto rounded-xl border border-line">
          <table className="num w-full text-sm">
            <caption className="sr-only">Valeur du bot, « acheter et garder » et chute depuis le sommet</caption>
            <thead className="sticky top-0 bg-raised text-left text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Bot</th>
                <th className="px-3 py-2 text-right font-medium">Acheter et garder</th>
                <th className="px-3 py-2 text-right font-medium">Chute depuis le sommet</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(({ p, dd }) => (
                <tr key={p.time} className="border-t border-line">
                  <td className="px-3 py-1.5 text-ink-2">{fmtFull(p.time)}</td>
                  <td className="px-3 py-1.5 text-right text-ink">{fmtMoney(p.equity, currency)}</td>
                  <td className="px-3 py-1.5 text-right text-ink-2">{p.benchmark != null ? fmtMoney(p.benchmark, currency) : '–'}</td>
                  <td className="px-3 py-1.5 text-right text-ink-2">{fmtNum(dd)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            width={w}
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            className="block w-full touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-md"
            role="img"
            aria-label={`${title} : ${fmtMoney(view[n - 1].equity, currency)}, ${fmtPct(pnlPct)} depuis le départ. Pire chute ${fmtNum(maxDd)} %. Flèches gauche/droite pour parcourir.`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            onPointerMove={(e) => onMove(e.clientX)}
            onPointerDown={(e) => onMove(e.clientX)}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={`${uid}-eq`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.2} />
                <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`${uid}-dd`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.down} stopOpacity={0.08} />
                <stop offset="100%" stopColor={COLORS.down} stopOpacity={0.3} />
              </linearGradient>
            </defs>

            {/* Grille et axe des valeurs */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke={COLORS.grid} shapeRendering="crispEdges" />
                <text x={x1 + 10} y={y(t)} dominantBaseline="middle" fontSize={11} fill={COLORS.ink3} className="num">
                  {compact(t)}
                </text>
              </g>
            ))}
            {/* Capital initial */}
            <line x1={x0} x2={x1} y1={y(initialCapital)} y2={y(initialCapital)} stroke={COLORS.ink3} strokeOpacity={0.55} shapeRendering="crispEdges" />
            <text x={x1 - 4} y={y(initialCapital) - 6} textAnchor="end" fontSize={10} fill={COLORS.ink3}>
              Capital initial
            </text>

            {/* Séries */}
            <path d={`${equityPath}L${x(n - 1)},${yBottom}L${x(0)},${yBottom}Z`} fill={`url(#${uid}-eq)`} />
            {benchPath && <path d={benchPath} fill="none" stroke={COLORS.bench} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
            <path d={equityPath} fill="none" stroke={COLORS.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover === null && (
              <circle cx={x(n - 1)} cy={y(view[n - 1].equity)} r={4} fill={COLORS.accent} stroke={COLORS.surface} strokeWidth={2} />
            )}

            {/* Drawdown */}
            <line x1={x0} x2={x1} y1={ddTop} y2={ddTop} stroke={COLORS.line} shapeRendering="crispEdges" />
            <path d={`${ddLine}L${x(n - 1)},${ddTop}L${x(0)},${ddTop}Z`} fill={`url(#${uid}-dd)`} stroke={COLORS.down} strokeOpacity={0.8} strokeWidth={1.25} />
            <text x={x0 + 2} y={ddTop - 5} fontSize={10} fontWeight={600} fill={COLORS.ink3} letterSpacing="0.06em">
              CHUTE DEPUIS LE SOMMET
            </text>
            <text x={x1 + 10} y={ddTop + ddH} dominantBaseline="middle" fontSize={10.5} fill={COLORS.ink3} className="num">
              {fmtNum(maxDd, 1)} %
            </text>

            {/* Axe du temps */}
            {timeTicks.map((i) => (
              <text
                key={i}
                x={Math.max(x0 + 18, Math.min(x1 - 18, x(i)))}
                y={h - 6}
                textAnchor="middle"
                fontSize={11}
                fill={COLORS.ink3}
                className="num"
              >
                {fmtTick(view[i].time)}
              </text>
            ))}

            {/* Curseur */}
            {hover !== null && view[hover] && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={yTop} y2={ddTop + ddH} stroke={COLORS.ink3} strokeOpacity={0.6} shapeRendering="crispEdges" />
                {view[hover].benchmark != null && (
                  <circle cx={x(hover)} cy={y(view[hover].benchmark as number)} r={4} fill={COLORS.bench} stroke={COLORS.surface} strokeWidth={2} />
                )}
                <circle cx={x(hover)} cy={y(view[hover].equity)} r={4.5} fill={COLORS.accent} stroke={COLORS.surface} strokeWidth={2} />
                <circle cx={x(hover)} cy={yDd(drawdowns[hover])} r={3.5} fill={COLORS.down} stroke={COLORS.surface} strokeWidth={2} />
              </g>
            )}
          </svg>

          {hover !== null && view[hover] && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-60 rounded-lg border border-line-strong bg-raised/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
              style={x(hover) > w - 260 ? { right: w - x(hover) + 12 } : { left: x(hover) + 12 }}
            >
              <div className="mb-1.5 text-ink-3">{fmtFull(view[hover].time)}</div>
              <TooltipRow color={COLORS.accent} label="Bot" value={fmtMoney(view[hover].equity, currency)} />
              {view[hover].benchmark != null && <TooltipRow color={COLORS.bench} label="Acheter et garder" value={fmtMoney(view[hover].benchmark as number, currency)} />}
              <TooltipRow color={COLORS.down} label="Chute depuis le sommet" value={`${fmtNum(drawdowns[hover])} %`} />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-3">
        <LegendKey color={COLORS.accent} label="Le bot (sa valeur totale)" />
        <LegendKey color={COLORS.bench} label="Acheter et garder : les mêmes actions achetées au départ, à parts égales, jamais revendues" />
      </div>
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-3">
        <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="num whitespace-nowrap font-semibold text-ink">{value}</span>
    </div>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-0.5 w-4 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Répartition du portefeuille : barre empilée (liquidités + positions)
// ---------------------------------------------------------------------------

export interface AllocationItem {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function AllocationBar({ items, currency }: { items: AllocationItem[]; currency: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = items.reduce((a, it) => a + Math.max(0, it.value), 0) || 1;
  const visible = items.filter((it) => it.value > 0);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px]" role="img" aria-label={visible.map((it) => `${it.label} ${fmtNum((it.value / total) * 100, 0)} %`).join(', ')}>
        {visible.map((it, i) => (
          <div
            key={it.key}
            className={cx(
              'h-full transition-opacity',
              i === 0 && 'rounded-l-[4px]',
              i === visible.length - 1 && 'rounded-r-[4px]',
              hover && hover !== it.key && 'opacity-40',
            )}
            style={{ width: `${(it.value / total) * 100}%`, background: it.color, minWidth: 3 }}
            onPointerEnter={() => setHover(it.key)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((it) => (
          <li
            key={it.key}
            className={cx('flex items-center justify-between gap-3 rounded-md px-1 text-sm transition-colors', hover === it.key && 'bg-raised')}
            onPointerEnter={() => setHover(it.key)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="inline-flex min-w-0 items-center gap-2 text-ink-2">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: it.color }} />
              <span className="truncate">{it.label}</span>
            </span>
            <span className="num shrink-0 whitespace-nowrap text-ink">
              {fmtMoney(it.value, currency)} <span className="ml-1 inline-block w-14 text-right text-ink-3">{fmtNum((it.value / total) * 100, 1)} %</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jauge stop-loss → objectif : où se situe le cours actuel ?
// ---------------------------------------------------------------------------

export function RiskTrack({ stop, target, entry, price, className = 'w-36' }: { stop: number | null; target: number | null; entry: number; price: number; className?: string }) {
  const lo = stop ?? Math.min(entry, price) * 0.97;
  const hi = target ?? Math.max(entry, price) * 1.03;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100))}%`;
  const up = price >= entry;
  return (
    <div className={className} title={`Stop ${stop ? stop.toFixed(2) : '—'} · achat ${entry.toFixed(2)} · cours ${price.toFixed(2)} · objectif ${target ? target.toFixed(2) : '—'}`}>
      <div className="relative h-1.5 rounded-full bg-line">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-down/40" style={{ width: pos(entry) }} />
        <div className="absolute inset-y-0 right-0 rounded-r-full bg-up/40" style={{ left: pos(entry) }} />
        <div className="absolute -top-1 h-3.5 w-px bg-ink-2" style={{ left: pos(entry) }} />
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
          style={{ left: pos(price), background: up ? COLORS.up : COLORS.down }}
        />
      </div>
      <div className="num mt-1.5 flex justify-between text-[10.5px] text-ink-3">
        <span>{stop ? `stop-loss ${fmtNum(stop)}` : 'pas de stop-loss'}</span>
        <span>{target ? `objectif ${fmtNum(target)}` : "pas d'objectif"}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini-courbe
// ---------------------------------------------------------------------------

export function Sparkline({ values, base, className, color }: { values: number[]; base?: number; className?: string; color?: string }) {
  if (values.length < 2) return <div className={className} />;
  const w = 120;
  const h = 36;
  const ref = base ?? values[0];
  const min = Math.min(...values, ref);
  const max = Math.max(...values, ref);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const stroke = color ?? (values[values.length - 1] >= ref ? COLORS.up : COLORS.down);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2={w} y1={y(ref)} y2={y(ref)} stroke={COLORS.line} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Graphique des cours : chandeliers + indicateurs + achats / ventes du bot
// ---------------------------------------------------------------------------

function baseOptions(intraday: boolean): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: COLORS.ink3,
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: 11,
      attributionLogo: true,
      panes: { separatorColor: COLORS.line, separatorHoverColor: 'rgba(240,239,236,0.08)' },
    },
    grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
    rightPriceScale: { borderVisible: false },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: COLORS.ink3, style: LineStyle.Solid, width: 1, labelBackgroundColor: '#2a2a2f' },
      horzLine: { color: COLORS.ink3, style: LineStyle.Solid, width: 1, labelBackgroundColor: '#2a2a2f' },
    },
    timeScale: {
      borderVisible: false,
      timeVisible: intraday,
      secondsVisible: false,
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

function markerFor(trade: TradeMark, barTime: number, withText: boolean): SeriesMarker<Time> {
  // Sur un petit écran, les mots se chevauchent : on garde seulement les flèches (expliquées dans la légende).
  const label = !withText
    ? ''
    : trade.trigger === 'stop_loss'
      ? 'Stop-loss'
      : trade.trigger === 'take_profit'
        ? 'Objectif'
        : trade.side === 'BUY'
          ? 'Achat'
          : 'Vente';
  return trade.side === 'BUY'
    ? { time: toSec(barTime), position: 'belowBar', shape: 'arrowUp', color: COLORS.up, text: label }
    : { time: toSec(barTime), position: 'aboveBar', shape: 'arrowDown', color: COLORS.down, text: label };
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
          if (ov.type === 'histogram') return { time: toSec(b.time), value: v, color: v >= 0 ? 'rgba(46,189,133,0.5)' : 'rgba(246,70,93,0.5)' };
          return { time: toSec(b.time), value: v };
        }),
      );
    }
    const marks = trades
      .map((t) => ({ t, barTime: barTimeFor(bars, t.time) }))
      .filter((m): m is { t: TradeMark; barTime: number } => m.barTime !== null)
      .sort((a, b) => a.barTime - b.barTime)
      .map((m) => markerFor(m.t, m.barTime, (container.current?.clientWidth ?? 0) >= 640));
    c.markers.setMarkers(marks);

    if (!c.fitted && bars.length > 0) {
      c.fitted = true;
      if (initialBars && bars.length > initialBars) c.chart.timeScale().setVisibleLogicalRange({ from: bars.length - initialBars, to: bars.length + 2 });
      else c.chart.timeScale().fitContent();
    }
  };

  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, baseOptions(interval !== '1d'));
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderVisible: false,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
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
        s.createPriceLine({ price: level, color: '#4a4a52', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' });
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
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        {overlays.map((ov) => (
          <LegendKey key={ov.key} color={ov.type === 'histogram' ? COLORS.ink3 : ov.color} label={ov.pane === 'oscillator' ? `${ov.label} (panneau du bas)` : ov.label} />
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="text-up">▲</span> achat du bot <span className="ml-2 text-down">▼</span> vente du bot
        </span>
      </div>
      <div ref={container} style={{ height }} />
    </div>
  );
}
