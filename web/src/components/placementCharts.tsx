// Graphiques d'un placement, pensés pour quelqu'un qui n'y connaît rien :
//   - ValueChart : ce que vaut le placement, comparé à la mise de départ et à la limite de perte, avec les achats et ventes ;
//   - AssetChart : le cours d'un placement, le moment où le bot l'a acheté (et revendu), et la zone de gain ou de perte ;
//   - RiskMap : tous les placements analysés par le bot, rangés selon leur agitation et leur gain de l'an passé.

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { BANDS, bandOf, dailyMove, PROFILES, quality, type RiskBand } from '../../../shared/profile.ts';
import type { Bar, EquityPoint, Quote, RiskLevel, SelectionMeasure, Trade } from '../../../shared/types.ts';
import { fmtMoney, fmtNum, fmtPct, fmtPrice } from '../lib/format.ts';
import { COLORS, compact, niceTicks, useElementWidth } from './charts.tsx';
import { cx, Segmented } from './ui.tsx';

const DAY = 86_400_000;

const fmtClock = (t: number) => new Date(t).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
const fmtDayShort = (t: number) => new Date(t).toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' });
const fmtDayLong = (t: number) => new Date(t).toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Index du point le plus proche d'un instant (les points sont triés par date). */
function nearestIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(times[hi] - t) < Math.abs(times[lo] - t) ? hi : lo;
}

/** Graduations du temps : quelques dates bien réparties, au format adapté à la durée affichée. */
function timeTicks(t0: number, t1: number, width: number) {
  const count = Math.max(2, Math.min(5, Math.floor(width / 120)));
  const span = t1 - t0;
  const fmt = (t: number) =>
    span < 2 * DAY
      ? fmtClock(t)
      : span > 200 * DAY
        ? new Date(t).toLocaleDateString('fr-CH', { month: 'short', year: '2-digit' })
        : fmtDayShort(t);
  return Array.from({ length: count }, (_, k) => {
    const t = t0 + (k / (count - 1)) * span;
    return { t, label: fmt(t) };
  });
}

/** Petite étiquette arrondie dessinée dans un SVG (largeur estimée d'après le texte). */
function Pill({ x, y, text, fill, color, anchor = 'middle' }: { x: number; y: number; text: string; fill: string; color: string; anchor?: 'start' | 'middle' | 'end' }) {
  const w = text.length * 6.1 + 14;
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return (
    <g>
      <rect x={left} y={y - 10} width={w} height={20} rx={10} fill={fill} />
      <text x={left + w / 2} y={y + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={600} fill={color}>
        {text}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// La valeur du placement
// ---------------------------------------------------------------------------

export interface ValueEvent {
  time: number;
  side: 'BUY' | 'SELL';
}

export function ValueChart({ points, initialCapital, currency, lossFloor, events, height = 260, onHover }: {
  points: EquityPoint[];
  initialCapital: number;
  currency: string;
  /** Limite de perte : en dessous, le bot vend tout. */
  lossFloor: number | null;
  events: ValueEvent[];
  height?: number;
  /** Le point survolé (null quand le curseur quitte le graphique), pour afficher sa valeur en grand. */
  onHover?: (p: EquityPoint | null) => void;
}) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');

  const n = points.length;
  const w = Math.max(width, 280);
  const h = height;
  const PAD = { top: 36, right: 66, bottom: 24, left: 4 };
  const x0 = PAD.left;
  const x1 = w - PAD.right;
  const yTop = PAD.top;
  const yBottom = h - PAD.bottom;
  const t0 = n ? points[0].time : 0;
  const t1 = n ? Math.max(points[n - 1].time, t0 + 60_000) : 1;
  const times = useMemo(() => points.map((p) => p.time), [points]);

  // Échelle des valeurs : la mise de départ est toujours visible ; la limite de perte seulement si elle est proche.
  const { lo, hi, floorVisible } = useMemo(() => {
    let a = initialCapital;
    let b = initialCapital;
    for (const p of points) {
      a = Math.min(a, p.equity);
      b = Math.max(b, p.equity);
    }
    const minSpan = initialCapital * 0.006;
    if (b - a < minSpan) {
      const mid = (a + b) / 2;
      a = mid - minSpan / 2;
      b = mid + minSpan / 2;
    }
    const pad = (b - a) * 0.18;
    const visible = lossFloor !== null && lossFloor >= a - (b - a) * 0.8;
    if (visible && lossFloor !== null) a = Math.min(a, lossFloor);
    return { lo: a - pad, hi: b + pad, floorVisible: visible };
  }, [points, initialCapital, lossFloor]);

  const x = (t: number) => x0 + ((Math.max(t0, Math.min(t1, t)) - t0) / (t1 - t0 || 1)) * (x1 - x0);
  const y = (v: number) => yBottom - ((v - lo) / (hi - lo || 1)) * (yBottom - yTop);
  const yBase = y(initialCapital);
  const last = points[n - 1];
  const up = !last || last.equity >= initialCapital;
  const lineColor = up ? COLORS.up : COLORS.down;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.equity).toFixed(1)}`).join('');
  const area = n ? `${line}L${x(t1).toFixed(1)},${yBase.toFixed(1)}L${x(t0).toFixed(1)},${yBase.toFixed(1)}Z` : '';

  // Achats et ventes rapprochés (par exemple : tous les achats du premier jour) regroupés en une seule étiquette.
  const clusters = useMemo(() => {
    const out: { x: number; time: number; buys: number; sells: number }[] = [];
    for (const e of [...events].sort((a, b) => a.time - b.time)) {
      const ex = x(e.time);
      const c = out[out.length - 1];
      if (c && ex - c.x < 90) {
        c[e.side === 'BUY' ? 'buys' : 'sells'] += 1;
        c.time = e.time;
      } else out.push({ x: ex, time: e.time, buys: e.side === 'BUY' ? 1 : 0, sells: e.side === 'SELL' ? 1 : 0 });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, t0, t1, w]);

  const valueAt = (t: number) => (n ? points[nearestIndex(times, t)].equity : initialCapital);

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || n < 2) return;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * w;
    const t = t0 + ((px - x0) / (x1 - x0)) * (t1 - t0);
    const i = nearestIndex(times, t);
    setHover(i);
    onHover?.(points[i]);
  };
  const leave = () => {
    setHover(null);
    onHover?.(null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = Math.max(0, Math.min(n - 1, (hover ?? n - 1) + (e.key === 'ArrowLeft' ? -1 : 1)));
    setHover(i);
    onHover?.(points[i]);
  };

  if (n < 2) {
    return (
      <div ref={wrapRef} className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 text-center" style={{ height }}>
        <p className="text-sm font-medium text-ink-2">La courbe se dessine au fil des analyses</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-3">Le bot note la valeur du placement à chaque analyse, toutes les minutes quand la bourse est ouverte.</p>
      </div>
    );
  }

  const ticks = niceTicks(lo, hi, 4).filter((t) => y(t) > yTop + 6 && y(t) < yBottom - 4);
  const hp = hover !== null ? points[hover] : null;

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        ref={svgRef}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="block w-full touch-pan-y select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        role="img"
        aria-label={`Valeur du placement : ${fmtMoney(last.equity, currency)}, pour une mise de départ de ${fmtMoney(initialCapital, currency)}.${lossFloor !== null ? ` Limite de perte : ${fmtMoney(lossFloor, currency, 0)}.` : ''} Flèches gauche et droite pour parcourir.`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={leave}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={leave}
      >
        <defs>
          <linearGradient id={`${uid}-up`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.up} stopOpacity={0.28} />
            <stop offset="100%" stopColor={COLORS.up} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={`${uid}-down`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={COLORS.down} stopOpacity={0.3} />
            <stop offset="100%" stopColor={COLORS.down} stopOpacity={0.02} />
          </linearGradient>
          <clipPath id={`${uid}-above`}>
            <rect x={0} y={0} width={w} height={Math.max(0, yBase)} />
          </clipPath>
          <clipPath id={`${uid}-below`}>
            <rect x={0} y={yBase} width={w} height={Math.max(0, h - yBase)} />
          </clipPath>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke={COLORS.grid} shapeRendering="crispEdges" />
            <text x={x1 + 8} y={y(t)} dominantBaseline="middle" fontSize={10.5} fill={COLORS.ink3} className="num">
              {compact(t)}
            </text>
          </g>
        ))}

        {/* Au-dessus de la mise : vert ; en dessous : rouge. */}
        <path d={area} fill={`url(#${uid}-up)`} clipPath={`url(#${uid}-above)`} />
        <path d={area} fill={`url(#${uid}-down)`} clipPath={`url(#${uid}-below)`} />

        {/* La mise de départ */}
        <line x1={x0} x2={x1} y1={yBase} y2={yBase} stroke={COLORS.ink2} strokeOpacity={0.6} strokeDasharray="4 4" shapeRendering="crispEdges" />
        <Pill x={x1 + 4} y={yBase} text={compact(initialCapital)} fill="#2a2a2f" color={COLORS.ink} anchor="start" />
        <text x={x0 + 4} y={yBase + (up ? 14 : -8)} fontSize={10.5} fill={COLORS.ink3}>
          Votre mise de départ
        </text>

        {/* La limite de perte */}
        {lossFloor !== null &&
          (floorVisible ? (
            <g>
              <line x1={x0} x2={x1} y1={y(lossFloor)} y2={y(lossFloor)} stroke={COLORS.down} strokeOpacity={0.8} strokeDasharray="2 4" shapeRendering="crispEdges" />
              <text x={x0 + 4} y={y(lossFloor) - 6} fontSize={10.5} fill={COLORS.down}>
                Limite de perte : le bot vend tout en dessous
              </text>
              <Pill x={x1 + 4} y={y(lossFloor)} text={compact(lossFloor)} fill="#3a1a20" color={COLORS.down} anchor="start" />
            </g>
          ) : (
            <g>
              <text x={x1 - 2} y={yBottom - 6} textAnchor="end" fontSize={10.5} fill={COLORS.ink3}>
                Limite de perte ({fmtMoney(lossFloor, currency, 0)}) bien plus bas ↓
              </text>
            </g>
          ))}

        <path d={line} fill="none" stroke={lineColor} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" className="draw-line" pathLength={1} />

        {/* Achats et ventes */}
        {clusters.map((c) => {
          const cy = y(valueAt(c.time));
          const parts = [c.buys ? `▲ ${c.buys > 1 ? `${c.buys} achats` : 'Achat'}` : '', c.sells ? `▼ ${c.sells > 1 ? `${c.sells} ventes` : 'Vente'}` : ''].filter(Boolean);
          const text = parts.join(' · ');
          const pw = text.length * 6.1 + 14;
          const anchor = c.x - pw / 2 < x0 ? 'start' : c.x + pw / 2 > x1 ? 'end' : 'middle';
          const sellOnly = c.sells > 0 && c.buys === 0;
          return (
            <g key={`${c.time}-${c.x}`}>
              <line x1={c.x} x2={c.x} y1={yTop - 8} y2={cy} stroke={sellOnly ? COLORS.down : COLORS.up} strokeOpacity={0.55} strokeDasharray="2 3" />
              <circle cx={c.x} cy={cy} r={5} fill={sellOnly ? COLORS.down : COLORS.up} stroke={COLORS.surface} strokeWidth={2} />
              <Pill x={anchor === 'start' ? c.x - 8 : anchor === 'end' ? c.x + 8 : c.x} y={yTop - 18} text={text} fill={sellOnly ? '#3a1a20' : '#123526'} color={sellOnly ? '#ff8a99' : '#5fe0ab'} anchor={anchor} />
            </g>
          );
        })}

        {hover === null && <circle cx={x(last.time)} cy={y(last.equity)} r={4.5} fill={lineColor} stroke={COLORS.surface} strokeWidth={2} className="pulse-dot" />}

        {timeTicks(t0, t1, x1 - x0).map(({ t, label }, i, arr) => (
          <text
            key={t}
            x={x(t)}
            y={h - 6}
            textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}
            fontSize={10.5}
            fill={COLORS.ink3}
            className="num"
          >
            {label}
          </text>
        ))}

        {hp && (
          <g>
            <line x1={x(hp.time)} x2={x(hp.time)} y1={yTop} y2={yBottom} stroke={COLORS.ink3} strokeOpacity={0.7} shapeRendering="crispEdges" />
            <circle cx={x(hp.time)} cy={y(hp.equity)} r={5} fill={hp.equity >= initialCapital ? COLORS.up : COLORS.down} stroke={COLORS.surface} strokeWidth={2} />
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Le cours d'un placement, avec les achats et ventes du bot
// ---------------------------------------------------------------------------

const ASSET_RANGES = [
  { id: '1m', label: '1 mois', ms: 31 * DAY },
  { id: '3m', label: '3 mois', ms: 92 * DAY },
  { id: '1y', label: '1 an', ms: 366 * DAY },
] as const;
type AssetRange = (typeof ASSET_RANGES)[number]['id'];

export function AssetChart({ bars, quote, trades, color, createdAt, height = 300 }: {
  bars: Bar[];
  quote: Quote;
  trades: Trade[];
  color: string;
  /** Date de lancement du placement : le bot a étudié l'année d'avant pour choisir. */
  createdAt: number;
  height?: number;
}) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  // Par défaut, une période où l'on voit bien l'achat : 1 mois pour un achat récent, 1 an pour un achat ancien.
  const [range, setRange] = useState<AssetRange>(() => {
    const first = Math.min(...trades.filter((t) => t.side === 'BUY').map((t) => t.time));
    if (!Number.isFinite(first)) return '3m';
    const age = Date.now() - first;
    return age < 20 * DAY ? '1m' : age < 75 * DAY ? '3m' : '1y';
  });
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');
  const cur = quote.currency;

  // Les cours de clôture, plus le dernier cours connu s'il est plus récent.
  const all = useMemo(() => {
    const pts = bars.map((b) => ({ time: b.time, price: b.close }));
    if (quote.price && (!pts.length || quote.priceTime > pts[pts.length - 1].time)) pts.push({ time: quote.priceTime, price: quote.price });
    return pts;
  }, [bars, quote]);

  const sortedTrades = useMemo(() => [...trades].sort((a, b) => a.time - b.time), [trades]);
  const tEnd = Math.max(all[all.length - 1]?.time ?? 0, sortedTrades[sortedTrades.length - 1]?.time ?? 0);
  const ms = ASSET_RANGES.find((r) => r.id === range)!.ms;
  const tStart = Math.max(all[0]?.time ?? 0, tEnd - ms);
  const view = all.filter((p) => p.time >= tStart);
  const times = view.map((p) => p.time);
  const n = view.length;

  // Périodes pendant lesquelles le bot possédait ce placement (d'un achat à la vente suivante, ou jusqu'à maintenant).
  const holds = useMemo(() => {
    const out: { from: number; to: number; price: number; exitPrice: number | null; closed: boolean }[] = [];
    let open: Trade | null = null;
    for (const t of sortedTrades) {
      if (t.side === 'BUY' && !open) open = t;
      else if (t.side === 'SELL' && open) {
        out.push({ from: open.time, to: t.time, price: open.price, exitPrice: t.price, closed: true });
        open = null;
      }
    }
    if (open) out.push({ from: open.time, to: tEnd, price: open.price, exitPrice: null, closed: false });
    return out;
  }, [sortedTrades, tEnd]);

  const w = Math.max(width, 280);
  const h = height;
  const PAD = { top: 40, right: 70, bottom: 24, left: 4 };
  const x0 = PAD.left;
  const x1 = w - PAD.right;
  const yTop = PAD.top;
  const yBottom = h - PAD.bottom;

  const [lo, hi] = useMemo(() => {
    let a = Infinity;
    let b = -Infinity;
    for (const p of view) {
      a = Math.min(a, p.price);
      b = Math.max(b, p.price);
    }
    for (const t of sortedTrades) {
      if (t.time < tStart) continue;
      a = Math.min(a, t.price);
      b = Math.max(b, t.price);
    }
    for (const hd of holds) {
      a = Math.min(a, hd.price);
      b = Math.max(b, hd.price);
    }
    if (!Number.isFinite(a)) return [0, 1];
    const pad = (b - a) * 0.12 || a * 0.02;
    return [a - pad, b + pad];
  }, [view, sortedTrades, holds, tStart]);

  const x = (t: number) => x0 + ((Math.max(tStart, Math.min(tEnd, t)) - tStart) / (tEnd - tStart || 1)) * (x1 - x0);
  const y = (v: number) => yBottom - ((v - lo) / (hi - lo || 1)) * (yBottom - yTop);
  const pathOf = (pts: { time: number; price: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.price).toFixed(1)}`).join('');

  const priceAt = (t: number) => {
    if (!n) return quote.price;
    return view[nearestIndex(times, t)].price;
  };
  const holdAt = (t: number) => holds.find((hd) => t >= hd.from - DAY && t <= hd.to);

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || n < 2) return;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * w;
    setHover(nearestIndex(times, tStart + ((px - x0) / (x1 - x0)) * (tEnd - tStart)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setHover((c) => Math.max(0, Math.min(n - 1, (c ?? n - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
  };

  if (n < 2) return <div ref={wrapRef} style={{ height }} className="flex items-center justify-center text-sm text-ink-3">Pas assez de cours pour dessiner le graphique.</div>;

  const ticks = niceTicks(lo, hi, 4).filter((t) => y(t) > yTop + 4 && y(t) < yBottom - 4);
  const studiedFrom = createdAt - 365 * DAY;
  const last = view[n - 1];
  const hp = hover !== null ? view[hover] : null;
  const hpHold = hp ? holdAt(hp.time) : undefined;
  const narrow = w < 520;

  return (
    <div ref={wrapRef} className="w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="num min-h-[20px] text-xs text-ink-3">
          {hp ? (
            <>
              <span className="text-ink-2">{fmtDayLong(hp.time)}</span> · {fmtPrice(hp.price)} {cur}
              {hpHold && hp.time >= hpHold.from - DAY && (
                <span className={hp.price >= hpHold.price ? 'text-up' : 'text-down'}> · {fmtPct((hp.price / hpHold.price - 1) * 100)} par rapport au prix d'achat</span>
              )}
            </>
          ) : (
            'Glissez sur le graphique pour lire le cours à chaque date.'
          )}
        </div>
        <Segmented value={range} onChange={setRange} items={ASSET_RANGES.map((r) => ({ id: r.id, label: r.label }))} />
      </div>
      <svg
        ref={svgRef}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="block w-full touch-pan-y select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        role="img"
        aria-label={`Cours de ${quote.name} : ${fmtPrice(last.price)} ${cur}.${holds.length ? ` Acheté par le bot à ${fmtPrice(holds[0].price)} ${cur}.` : ''}`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${uid}-gain`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.up} stopOpacity={0.35} />
            <stop offset="100%" stopColor={COLORS.up} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id={`${uid}-loss`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={COLORS.down} stopOpacity={0.35} />
            <stop offset="100%" stopColor={COLORS.down} stopOpacity={0.05} />
          </linearGradient>
        </defs>

        {/* L'année étudiée par le bot avant de choisir */}
        {studiedFrom < tEnd && createdAt > tStart && (
          <g>
            <rect x={x(studiedFrom)} y={yTop - 30} width={Math.max(0, x(createdAt) - x(studiedFrom))} height={yBottom - yTop + 30} fill="#ffffff" fillOpacity={0.025} />
            <line x1={x(createdAt)} x2={x(createdAt)} y1={yTop - 30} y2={yBottom} stroke={COLORS.ink3} strokeOpacity={0.35} strokeDasharray="3 3" />
            {!narrow && x(createdAt) - x(Math.max(studiedFrom, tStart)) > 200 && (
              <text x={x(createdAt) - 8} y={yTop - 22} textAnchor="end" fontSize={10.5} fill={COLORS.ink3}>
                ← L'année que le bot a étudiée avant de choisir
              </text>
            )}
          </g>
        )}

        {ticks.map((t) => (
          <g key={t}>
            <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke={COLORS.grid} shapeRendering="crispEdges" />
            <text x={x1 + 8} y={y(t)} dominantBaseline="middle" fontSize={10.5} fill={COLORS.ink3} className="num">
              {compact(t)}
            </text>
          </g>
        ))}

        {/* Le cours, en gris tant que le bot ne possédait pas le placement */}
        <path d={pathOf(view)} fill="none" stroke={COLORS.ink3} strokeOpacity={0.75} strokeWidth={1.5} strokeLinejoin="round" />

        {/* Les périodes de possession : zone verte au-dessus du prix d'achat (gain), rouge en dessous (perte) */}
        {holds.map((hd, k) => {
          if (hd.to < tStart) return null;
          // Du prix d'achat (ou du début de la période affichée) jusqu'à la vente (ou au dernier cours).
          const seg = [
            ...(hd.from >= tStart ? [{ time: hd.from, price: hd.price }] : []),
            ...view.filter((p) => p.time > hd.from && (hd.closed ? p.time < hd.to : p.time <= hd.to)),
            ...(hd.exitPrice !== null ? [{ time: hd.to, price: hd.exitPrice }] : []),
          ];
          if (seg.length < 2) return null;
          const d = pathOf(seg);
          const yb = y(hd.price);
          const xa = x(seg[0].time);
          const xb = x(seg[seg.length - 1].time);
          const area = `${d}L${xb.toFixed(1)},${yb.toFixed(1)}L${xa.toFixed(1)},${yb.toFixed(1)}Z`;
          return (
            <g key={k}>
              <clipPath id={`${uid}-a${k}`}>
                <rect x={0} y={0} width={w} height={Math.max(0, yb)} />
              </clipPath>
              <clipPath id={`${uid}-b${k}`}>
                <rect x={0} y={yb} width={w} height={Math.max(0, h - yb)} />
              </clipPath>
              <path d={area} fill={`url(#${uid}-gain)`} clipPath={`url(#${uid}-a${k})`} />
              <path d={area} fill={`url(#${uid}-loss)`} clipPath={`url(#${uid}-b${k})`} />
              <line x1={xa} x2={hd.closed ? xb : x1} y1={yb} y2={yb} stroke={COLORS.ink2} strokeOpacity={0.7} strokeDasharray="4 4" />
              <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              {!hd.closed && (
                <text x={x1 - 4} y={yb + (last.price >= hd.price ? 15 : -8)} textAnchor="end" fontSize={10.5} fill={COLORS.ink2} stroke={COLORS.surface} strokeWidth={3} paintOrder="stroke" className="num">
                  Prix d'achat {fmtPrice(hd.price)}
                </text>
              )}
            </g>
          );
        })}

        {/* Dernier cours */}
        <circle cx={x(last.time)} cy={y(last.price)} r={4} fill={holds.some((hd) => !hd.closed) ? color : COLORS.ink2} stroke={COLORS.surface} strokeWidth={2} />
        <Pill x={x1 + 4} y={y(last.price)} text={fmtPrice(last.price)} fill={holds.some((hd) => !hd.closed) ? color : '#3a3a40'} color="#fff" anchor="start" />

        {/* Achats (▲) et ventes (▼) du bot, avec la date et le prix */}
        {sortedTrades
          .filter((t) => t.time >= tStart)
          .map((t, i, arr) => {
            const buy = t.side === 'BUY';
            const tx = x(t.time);
            const ty = y(t.price);
            const crowded = arr.some((o, j) => j > i && Math.abs(x(o.time) - tx) < 70);
            const text = narrow || crowded ? (buy ? 'Achat' : 'Vente') : `${buy ? 'Achat' : 'Vente'} · ${fmtDayShort(t.time)} · ${fmtPrice(t.price)}`;
            const pw = text.length * 6.1 + 14;
            const anchor = tx + pw / 2 > x1 ? 'end' : tx - pw / 2 < x0 ? 'start' : 'middle';
            const py = buy ? Math.min(ty + 26, yBottom + 4) : Math.max(ty - 26, yTop - 18);
            return (
              <g key={t.id}>
                <line x1={tx} x2={tx} y1={ty} y2={py} stroke={buy ? COLORS.up : COLORS.down} strokeWidth={1.25} />
                <circle cx={tx} cy={ty} r={6} fill={buy ? COLORS.up : COLORS.down} stroke={COLORS.surface} strokeWidth={2.5} />
                <text x={tx} y={ty + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={8} fontWeight={800} fill="#0b0b0c">
                  {buy ? '▲' : '▼'}
                </text>
                <Pill x={anchor === 'end' ? tx + 10 : anchor === 'start' ? tx - 10 : tx} y={py} text={text} fill={buy ? '#123526' : '#3a1a20'} color={buy ? '#5fe0ab' : '#ff8a99'} anchor={anchor} />
              </g>
            );
          })}

        {timeTicks(tStart, tEnd, x1 - x0).map(({ t, label }, i, arr) => (
          <text key={t} x={x(t)} y={h - 6} textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'} fontSize={10.5} fill={COLORS.ink3} className="num">
            {label}
          </text>
        ))}

        {hp && (
          <g>
            <line x1={x(hp.time)} x2={x(hp.time)} y1={yTop - 30} y2={yBottom} stroke={COLORS.ink3} strokeOpacity={0.7} shapeRendering="crispEdges" />
            <circle cx={x(hp.time)} cy={y(priceAt(hp.time))} r={4.5} fill={COLORS.ink} stroke={COLORS.surface} strokeWidth={2} />
          </g>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-ink-3" /> Cours avant l'achat
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[3px] w-4 rounded-full" style={{ background: color }} /> Pendant que le bot le possède
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t border-dashed border-ink-2" /> Prix d'achat
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-up/40" /> Gain
          <span className="ml-1 size-2.5 rounded-sm bg-down/40" /> Perte
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// La carte des placements analysés : agitation (de gauche à droite) et gain de l'an passé (de bas en haut)
// ---------------------------------------------------------------------------

export const BAND_COLORS: Record<RiskBand, string> = {
  very_calm: '#2ebd85',
  calm: '#8ccf5a',
  medium: '#fab219',
  agitated: '#f08a3c',
  very_agitated: '#f6465d',
};

export function RiskMap({ measured, chosen, removed, level, colorOf, displayName, height = 340 }: {
  measured: SelectionMeasure[];
  chosen: string[];
  removed: string[];
  level: RiskLevel;
  colorOf: (symbol: string) => string;
  displayName: (m: SelectionMeasure) => string;
  height?: number;
}) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const w = Math.max(width, 300);
  const h = height;
  const PAD = { top: 30, right: 16, bottom: 40, left: 46 };
  const x0 = PAD.left;
  const x1 = w - PAD.right;
  const yTop = PAD.top;
  const yBottom = h - PAD.bottom;
  const allowed = new Set(PROFILES[level].slots);

  const maxVol = Math.max(55, ...measured.map((m) => m.volatility)) * 1.04;
  const perfs = measured.map((m) => m.perf1y);
  const pLo = Math.min(-10, ...perfs);
  const pHi = Math.max(20, ...perfs);
  const pad = (pHi - pLo) * 0.08;
  const x = (v: number) => x0 + (Math.min(v, maxVol) / maxVol) * (x1 - x0);
  const y = (p: number) => yBottom - ((p - (pLo - pad)) / (pHi + pad - (pLo - pad))) * (yBottom - yTop);

  const bands = BANDS.map((b, i) => ({ ...b, from: i ? BANDS[i - 1].max : 0, to: Math.min(b.max, maxVol) }));
  const isChosen = (s: string) => chosen.includes(s);
  const isRemoved = (s: string) => removed.includes(s);

  // Étiquettes des placements choisis : chacune à côté de son point, décalée vers le haut ou le bas si elle en touche une autre.
  const labels = useMemo(() => {
    const placed: { a: number; b: number; y: number }[] = [];
    return measured
      .filter((m) => isChosen(m.symbol) || isRemoved(m.symbol))
      .map((m) => ({ m, x: x(m.volatility), y: y(m.perf1y), text: `${displayName(m)}${isRemoved(m.symbol) ? ' (retiré)' : ''}` }))
      .sort((p, q) => p.y - q.y)
      .map((it) => {
        const tw = it.text.length * 6.6;
        const right = it.x + 12 + tw < x1;
        const a = right ? it.x + 12 : it.x - 12 - tw;
        const free = (ly: number) => ly > yTop + 6 && ly < yBottom - 6 && !placed.some((p) => a < p.b + 4 && a + tw > p.a - 4 && Math.abs(p.y - ly) < 15);
        let ly = it.y;
        for (const off of [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75]) {
          if (free(it.y + off)) {
            ly = it.y + off;
            break;
          }
        }
        placed.push({ a, b: a + tw, y: ly });
        return { ...it, ly, right };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured, chosen.join(), removed.join(), w, h]);

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * w;
    const py = ((e.clientY - box.top) / box.height) * h;
    let best: string | null = null;
    let bestD = 22 * 22;
    for (const m of measured) {
      const d = (x(m.volatility) - px) ** 2 + (y(m.perf1y) - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = m.symbol;
      }
    }
    setHover(best);
  };

  const hm = measured.find((m) => m.symbol === hover);
  const yTicks = niceTicks(pLo - pad, pHi + pad, 5).filter((t) => y(t) >= yTop && y(t) <= yBottom);
  const xTicks = [0, 10, 20, 30, 40, 50, 60, 70, 80].filter((v) => v <= maxVol);

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        ref={svgRef}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="block w-full touch-pan-y select-none"
        role="img"
        aria-label={`${measured.length} placements analysés, rangés selon leur agitation et leur gain de l'an passé. Le bot a choisi : ${measured
          .filter((m) => isChosen(m.symbol))
          .map(displayName)
          .join(', ')}.`}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHover(null)}
      >
        {/* Les tranches d'agitation ; celles de votre profil sont mises en avant */}
        {bands.map((b) =>
          b.from >= maxVol ? null : (
            <g key={b.id}>
              <rect x={x(b.from)} y={yTop} width={Math.max(0, x(b.to) - x(b.from))} height={yBottom - yTop} fill={BAND_COLORS[b.id]} fillOpacity={allowed.has(b.id) ? 0.1 : 0.025} />
              {x(b.to) - x(b.from) > 46 && (
                <text
                  x={(x(b.from) + x(b.to)) / 2}
                  y={yTop - 10}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={allowed.has(b.id) ? 700 : 500}
                  fill={allowed.has(b.id) ? BAND_COLORS[b.id] : COLORS.ink3}
                >
                  {b.label}
                </text>
              )}
            </g>
          ),
        )}

        {yTicks.map((t) => (
          <g key={t}>
            <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.ink3 : COLORS.grid} strokeOpacity={t === 0 ? 0.6 : 1} strokeDasharray={t === 0 ? '4 4' : undefined} shapeRendering="crispEdges" />
            <text x={x0 - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10.5} fill={COLORS.ink3} className="num">
              {t > 0 ? '+' : ''}
              {fmtNum(t, 0)} %
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} x={x(v)} y={yBottom + 14} textAnchor="middle" fontSize={10} fill={COLORS.ink3} className="num">
            {v} %
          </text>
        ))}
        <text x={(x0 + x1) / 2} y={h - 6} textAnchor="middle" fontSize={11} fill={COLORS.ink2}>
          ← plus calme · agitation (de combien le prix bouge en un an) · plus agité →
        </text>

        {/* Tous les placements analysés */}
        {measured
          .filter((m) => !isChosen(m.symbol))
          .map((m) => (
            <circle
              key={m.symbol}
              cx={x(m.volatility)}
              cy={y(m.perf1y)}
              r={hover === m.symbol ? 6 : 4}
              fill={isRemoved(m.symbol) ? 'none' : BAND_COLORS[bandOf(m.volatility)]}
              fillOpacity={0.55}
              stroke={isRemoved(m.symbol) ? COLORS.ink2 : 'none'}
              strokeDasharray="2 2"
              strokeWidth={1.5}
            />
          ))}
        {measured
          .filter((m) => isChosen(m.symbol))
          .map((m) => (
            <g key={m.symbol}>
              <circle cx={x(m.volatility)} cy={y(m.perf1y)} r={11} fill={colorOf(m.symbol)} fillOpacity={0.2} className="pulse-ring" />
              <circle cx={x(m.volatility)} cy={y(m.perf1y)} r={6.5} fill={colorOf(m.symbol)} stroke="#fff" strokeWidth={2} />
            </g>
          ))}
        {labels.map(({ m, x: lx, y: py, ly, right, text }) => (
          <g key={m.symbol}>
            {Math.abs(ly - py) > 4 && <line x1={right ? lx + 7 : lx - 7} y1={py} x2={right ? lx + 11 : lx - 11} y2={ly} stroke={COLORS.ink3} strokeWidth={1} />}
            <text
              x={right ? lx + 12 : lx - 12}
              y={ly}
              textAnchor={right ? 'start' : 'end'}
              dominantBaseline="middle"
              fontSize={11.5}
              fontWeight={isChosen(m.symbol) ? 650 : 500}
              fill={isChosen(m.symbol) ? COLORS.ink : COLORS.ink3}
              stroke={COLORS.surface}
              strokeWidth={3}
              paintOrder="stroke"
            >
              {text}
            </text>
          </g>
        ))}
      </svg>

      {hm && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-xl border border-line-strong bg-raised/95 px-3 py-2.5 text-xs shadow-xl backdrop-blur"
          style={{
            left: Math.min(Math.max(8, x(hm.volatility) - 112), w - 232),
            top: y(hm.perf1y) > h / 2 ? Math.max(0, y(hm.perf1y) - 128) : y(hm.perf1y) + 14,
          }}
        >
          <div className="font-semibold text-ink">{displayName(hm)}</div>
          <div className="mt-0.5 text-ink-3">
            {isChosen(hm.symbol) ? 'Choisi par le bot' : isRemoved(hm.symbol) ? 'Proposé, puis retiré par vous' : 'Analysé, pas choisi'}
          </div>
          <dl className="num mt-2 space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Agitation</dt>
              <dd className="text-ink">{BANDS.find((b) => b.id === bandOf(hm.volatility))?.label}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Bouge en un jour</dt>
              <dd className="text-ink">± {fmtNum(dailyMove(hm.volatility), 1)} %</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Sur l'année étudiée</dt>
              <dd className={hm.perf1y >= 0 ? 'text-up' : 'text-down'}>{fmtPct(hm.perf1y, 1)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Gain pour le risque</dt>
              <dd className="text-ink">{fmtNum(quality(hm), 2)}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-ink-3/70" /> Un placement analysé
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full border-2 border-white bg-accent" /> Choisi par le bot
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cx('h-3 w-5 rounded-sm')} style={{ background: `${BAND_COLORS.calm}33` }} /> Les zones de votre profil
        </span>
      </div>
    </div>
  );
}
