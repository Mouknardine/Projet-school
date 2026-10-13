// La page d'un placement créé avec le questionnaire, pour quelqu'un qui n'y connaît rien :
//   1. ce que vaut son argent (et la courbe, avec la mise de départ et la limite de perte) ;
//   2. ce que le bot a fait, dans l'ordre : chaque achat, chaque vente, et ce qui va se passer ensuite ;
//   3. chaque placement, avec son graphique : quand le bot l'a acheté, à quel prix, et ce qu'il vaut aujourd'hui ;
//   4. comment le bot a choisi ces placements (son profil, ses mesures, la règle de choix) ;
//   5. quand il revendra.

import {
  ArrowDown,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  Hand,
  Layers,
  PauseCircle,
  PiggyBank,
  Play,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  assetInfo,
  BANDS,
  bandOf,
  computeProfile,
  dailyMove,
  LOCAL_CURRENCY_MAX_LEVEL,
  PROFILES,
  QUESTIONS,
  traceSelection,
  type AssetKind,
  type SlotTrace,
} from '../../../shared/profile.ts';
import type { BotDetail, EquityPoint, LogEntry, Position, RiskLevel, SelectionMeasure, SelectionSnapshot, Trade, WatchItem } from '../../../shared/types.ts';
import { Journal, LossBar, ManageCard, Stats } from '../components/botParts.tsx';
import { COLORS, SERIES } from '../components/charts.tsx';
import { AssetChart, BAND_COLORS, RiskMap, ValueChart } from '../components/placementCharts.tsx';
import { AgitationChip, LEVEL_COLORS, ProfileBadge, RiskGauge } from '../components/profile.tsx';
import { TradeDetail } from '../components/TradesTable.tsx';
import { Badge, Card, cx, Delta, ErrorBox, LiveDot, Sheet, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, fmtRelative, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { usePolling } from '../lib/usePolling.ts';

const DAY = 86_400_000;

const SECTIONS = [
  { id: 'resume', label: 'Résumé' },
  { id: 'historique', label: "Ce qu'il a fait" },
  { id: 'placements', label: 'Ses placements' },
  { id: 'choix', label: 'Comment il a choisi' },
  { id: 'ventes', label: 'Quand il vend' },
  { id: 'details', label: 'Détails' },
];

const KIND_LABEL: Record<AssetKind, string> = {
  action: 'Action',
  fonds: 'Fonds (ETF)',
  obligations: 'Obligations',
  or: 'Or',
  crypto: 'Cryptomonnaie',
};
const KIND_HELP: Record<AssetKind, string> = {
  action: "Une part d'une seule entreprise.",
  fonds: "Un panier de nombreuses entreprises, acheté en une fois : le risque est réparti.",
  obligations: "Un prêt : on est remboursé avec des intérêts. Bouge très peu.",
  or: 'Du métal précieux, souvent stable quand la bourse va mal.',
  crypto: 'Une monnaie numérique, très agitée.',
};

const swissTime = (t: number) => new Date(t).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
const zurichDay = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' });
const isWeekend = (t: number) => ['Sat', 'Sun'].includes(new Date(t).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Europe/Zurich' }));

function dayLabel(t: number, now: number): string {
  if (zurichDay(t) === zurichDay(now)) return "Aujourd'hui";
  if (zurichDay(t) === zurichDay(now - DAY)) return 'Hier';
  if (zurichDay(t) === zurichDay(now + DAY)) return 'Demain';
  const s = new Date(t).toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Bourse d'un placement, d'après son symbole Yahoo Finance. */
function exchangeOf(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith('-USD')) return 'le marché des cryptomonnaies';
  if (s.endsWith('.SW')) return 'la bourse suisse';
  if (s.endsWith('.PA')) return 'la bourse de Paris';
  if (s.endsWith('.AS')) return "la bourse d'Amsterdam";
  if (s.endsWith('.DE')) return 'la bourse de Francfort';
  if (s.endsWith('.L')) return 'la bourse de Londres';
  return 'la bourse de New York';
}

/** Prochaine ouverture de la bourse, à partir des horaires du jour (week-ends sautés ; jours fériés non connus). */
function nextOpening(w: WatchItem | undefined, now: number): number | null {
  const s = w?.session;
  if (!s || s.end - s.start >= 23 * 3_600_000) return null;
  let t = s.start;
  while (t <= now || isWeekend(t)) t += DAY;
  return t;
}

function whenBuys(w: WatchItem | undefined, now: number): string {
  if (w?.marketOpen) return 'dans la minute : sa bourse est ouverte';
  const t = nextOpening(w, now);
  if (!t) return 'à la prochaine ouverture de sa bourse';
  const day = dayLabel(t, now);
  return `${day === "Aujourd'hui" ? "aujourd'hui" : day === 'Demain' ? 'demain' : day.toLowerCase()} à ${swissTime(t)} (heure suisse)`;
}

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .split(/[\s&+-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

function AssetAvatar({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cx('flex shrink-0 items-center justify-center rounded-xl text-xs font-bold tracking-tight', className ?? 'size-10')}
      style={{ background: `${color}26`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// La page
// ---------------------------------------------------------------------------

export function PlacementView({ detail, equity, trades, logs, now, busy, run, remove, actionError, tickSeconds, brokerName }: {
  detail: BotDetail;
  equity: EquityPoint[] | null;
  trades: Trade[] | null;
  logs: LogEntry[] | null;
  now: number;
  busy: string | null;
  run: (label: string, fn: () => Promise<BotDetail | void>) => void;
  remove: () => void;
  actionError: string | null;
  tickSeconds: number;
  brokerName?: string;
}) {
  const { bot, summary, positions, watchlist, lossFloor, protection } = detail;
  const profile = bot.profile!;
  const info = PROFILES[profile.level];
  const cur = bot.currency;
  const selection = usePolling(() => api.selection(bot.id), [bot.id], 0);
  const [openTrade, setOpenTrade] = useState<Trade | null>(null);
  const [selected, setSelected] = useState<string>(bot.symbols[0]);

  const colorOf = (s: string) => SERIES[Math.max(0, bot.symbols.indexOf(s)) % SERIES.length];
  const watchOf = (s: string) => watchlist.find((w) => w.symbol === s);
  const nameOf = (s: string) => assetInfo(s)?.name ?? watchOf(s)?.name ?? s;
  const positionOf = (s: string) => positions.find((p) => p.symbol === s);
  const allTrades = useMemo(() => [...(trades ?? [])].sort((a, b) => a.time - b.time), [trades]);
  const everBought = (s: string) => allTrades.some((t) => t.symbol === s && t.side === 'BUY');
  const pending = bot.symbols.filter((s) => !positionOf(s) && !everBought(s));
  const sells = allTrades.filter((t) => t.side === 'SELL');
  const anyOpen = watchlist.some((w) => w.marketOpen);
  const perPlacement = (summary.equity * bot.positionSizePct) / 100;
  const pendingCash = Math.min(summary.cash, pending.length * perPlacement);
  const reserve = summary.cash - (bot.status === 'running' && !protection ? pendingCash : 0);
  const sellRule =
    bot.maxLossPct > 0
      ? `seulement si votre placement entier descend sous ${fmtMoney(lossFloor, cur, 0)} (−${bot.maxLossPct} %, votre limite de perte), ou si vous le décidez.`
      : 'seulement si vous le décidez.';

  const status =
    protection && bot.status === 'running'
      ? { tone: 'warn' as const, label: 'Protection en cours', live: false }
      : bot.status === 'paused'
        ? { tone: 'warn' as const, label: 'En pause', live: false }
        : anyOpen
          ? { tone: 'up' as const, label: 'Actif · bourse ouverte', live: true }
          : { tone: 'neutral' as const, label: 'Actif · bourse fermée', live: false };

  const trace = useMemo(() => (selection.data ? traceSelection(profile.level, selection.data.measured, selection.data.favorites) : null), [selection.data, profile.level]);
  const slotOf = (s: string): { index: number; slot: SlotTrace } | null => {
    const index = trace?.slots.findIndex((sl) => sl.chosen === s) ?? -1;
    return trace && index >= 0 ? { index, slot: trace.slots[index] } : null;
  };

  const selectAsset = (s: string) => {
    setSelected(s);
    document.getElementById('placement-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="animate-fade-up space-y-5 lg:space-y-6">
      {/* En-tête */}
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2 [&_svg]:size-4">
          <ArrowLeft aria-hidden /> Mes placements
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{bot.name}</h1>
          <Badge tone={status.tone} className="px-2 py-1">
            <LiveDot on={status.live} />
            {status.label}
          </Badge>
          <ProfileBadge level={profile.level} className="py-1" />
        </div>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">
          Un robot gère ces {fmtMoney(bot.initialCapital, cur, 0)} d'argent fictif selon votre profil, sur les vrais cours de la bourse. Vous n'avez rien à
          décider : voici tout ce qu'il a fait, et pourquoi.
        </p>
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-ink-3">
          <Clock className="size-3.5" aria-hidden /> Dernière vérification {fmtRelative(bot.lastTickAt, now)} · il vérifie toutes les {tickSeconds} secondes
        </p>
      </div>

      <nav aria-label="Sommaire de la page" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2 pb-1">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex h-8 items-center whitespace-nowrap rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {actionError && <ErrorBox>{actionError}</ErrorBox>}
      {protection && (
        <div className="flex gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm leading-relaxed text-ink-2">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          <div>
            <div className="font-semibold text-ink">Limite de perte atteinte le {fmtDateTime(protection.since)}</div>
            <p className="mt-0.5">
              Le placement était descendu à {fmtMoney(protection.equity, cur)}, soit {fmtNum((1 - protection.equity / protection.base) * 100, 1)}&nbsp;% de moins que{' '}
              {fmtMoney(protection.base, cur)}. Comme prévu, le bot {positions.length ? 'vend tout dès que les bourses ouvrent' : 'a tout vendu pour protéger votre argent'}
              {bot.status === 'paused' ? ' et s’est mis en pause. Vous pouvez le relancer plus bas, dans « Gérer ».' : '.'}
            </p>
          </div>
        </div>
      )}
      {bot.lastError && <ErrorBox>Problème lors de la dernière vérification : {bot.lastError}</ErrorBox>}

      <Hero
        detail={detail}
        equity={equity}
        trades={allTrades}
        pending={pending}
        pendingCash={bot.status === 'running' && !protection ? pendingCash : 0}
        reserve={reserve}
        colorOf={colorOf}
        nameOf={nameOf}
      />

      <Timeline
        detail={detail}
        trades={allTrades}
        logs={logs}
        now={now}
        pending={pending}
        perPlacement={perPlacement}
        analysed={selection.data?.measured.length ?? null}
        colorOf={colorOf}
        nameOf={nameOf}
        watchOf={watchOf}
        onOpenTrade={setOpenTrade}
      />

      {/* Chaque placement */}
      <section id="placements" className="scroll-mt-20 space-y-3">
        <SectionTitle
          icon={<Layers />}
          title="Ses placements, un par un"
          text="Touchez un placement pour voir son graphique : où le bot l'a acheté, à quel prix, et ce qu'il vaut aujourd'hui."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-5">
          <ul className="space-y-2" aria-label="Placements du bot">
            {bot.symbols.map((s) => (
              <li key={s}>
                <HoldingRow
                  symbol={s}
                  name={nameOf(s)}
                  color={colorOf(s)}
                  position={positionOf(s)}
                  currency={cur}
                  equity={summary.equity}
                  pending={pending.includes(s)}
                  when={whenBuys(watchOf(s), now)}
                  active={s === selected}
                  onSelect={() => selectAsset(s)}
                />
              </li>
            ))}
            <li>
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line px-3.5 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-3 [&_svg]:size-5">
                  <PiggyBank aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink">Réserve</div>
                  <div className="text-xs leading-snug text-ink-3">
                    {info.maxInvestedPct < 100 ? `Gardée de côté, jamais investie (${100 - info.maxInvestedPct} % prévus par votre profil)` : 'Le reste, après les frais'}
                  </div>
                </div>
                <div className="num text-right text-sm font-semibold text-ink">{fmtMoney(reserve, cur, 0)}</div>
              </div>
            </li>
          </ul>
          <PlacementDetail
            key={selected}
            botId={bot.id}
            symbol={selected}
            name={nameOf(selected)}
            color={colorOf(selected)}
            position={positionOf(selected)}
            watch={watchOf(selected)}
            pending={pending.includes(selected)}
            perPlacement={perPlacement}
            createdAt={bot.createdAt}
            currency={cur}
            equity={summary.equity}
            volatility={selection.data?.measured.find((m) => m.symbol === selected)?.volatility ?? profile.volatility[selected] ?? null}
            slot={slotOf(selected)}
            favorite={trace?.favorites.includes(selected) ?? false}
            tradesVersion={summary.tradesCount}
            now={now}
          />
        </div>
      </section>

      <HowItChose
        level={profile.level}
        answers={profile.answers}
        selection={selection.data}
        selectionError={selection.error}
        trace={trace}
        symbols={bot.symbols}
        currency={cur}
        positionSizePct={bot.positionSizePct}
        initialCapital={bot.initialCapital}
        colorOf={colorOf}
        nameOf={nameOf}
      />

      <WhenItSells
        maxLossPct={bot.maxLossPct}
        lossFloor={lossFloor}
        equity={summary.equity}
        currency={cur}
        paused={bot.status === 'paused'}
        sells={sells.length}
      />

      {/* Pour les curieux */}
      <details id="details" className="group scroll-mt-20 rounded-2xl border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold text-ink">Pour les curieux</span>
            <span className="mt-0.5 block text-xs text-ink-3">Statistiques, journal complet du bot et vos réponses au questionnaire.</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-5 border-t border-line p-3 sm:p-5">
          <Stats bot={bot} summary={summary} brokerName={brokerName} />
          <Card title="Vos réponses au questionnaire" subtitle="Le bot a été réglé à partir de ces réponses.">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {QUESTIONS.filter((q) => profile.answers[q.id]).map((q) => (
                <div key={q.id}>
                  <dt className="text-xs text-ink-3">{q.title}</dt>
                  <dd className="text-ink">{q.options.find((o) => o.id === profile.answers[q.id])?.label ?? profile.answers[q.id]}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Journal logs={logs} />
        </div>
      </details>

      <ManageCard bot={bot} busy={busy} onRun={run} onDelete={remove} />

      <Sheet
        open={!!openTrade}
        onClose={() => setOpenTrade(null)}
        resetKey={openTrade}
        title={openTrade ? `${openTrade.side === 'BUY' ? 'Achat' : 'Vente'} : ${nameOf(openTrade.symbol)}` : ''}
      >
        {openTrade && (
          <TradeDetail
            trade={openTrade}
            trades={allTrades}
            currency={cur}
            context={{ names: Object.fromEntries(bot.symbols.map((s) => [s, nameOf(s)])), sellRule }}
            onOpen={(t) => setOpenTrade(t as Trade)}
          />
        )}
      </Sheet>
    </div>
  );
}

function SectionTitle({ icon, title, text, id }: { icon: ReactNode; title: string; text?: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex scroll-mt-20 items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-text [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {text && <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-ink-3">{text}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Ce que vaut l'argent
// ---------------------------------------------------------------------------

function Hero({ detail, equity, trades, pending, pendingCash, reserve, colorOf, nameOf }: {
  detail: BotDetail;
  equity: EquityPoint[] | null;
  trades: Trade[];
  pending: string[];
  pendingCash: number;
  reserve: number;
  colorOf: (s: string) => string;
  nameOf: (s: string) => string;
}) {
  const { bot, summary, positions, lossFloor } = detail;
  const cur = bot.currency;
  const [hover, setHover] = useState<EquityPoint | null>(null);
  const wide = useMediaQuery('(min-width: 1280px)');
  const shown = hover?.equity ?? summary.equity;
  const pnl = shown - bot.initialCapital;
  const pnlPct = (pnl / bot.initialCapital) * 100;
  const sells = trades.filter((t) => t.side === 'SELL').length;
  const margin = lossFloor !== null ? summary.equity - lossFloor : null;

  const segments = [
    ...positions.map((p) => ({ key: p.symbol, label: nameOf(p.symbol), value: p.marketValue, color: colorOf(p.symbol), striped: false })),
    ...(pendingCash > 0 ? pending.map((s) => ({ key: s, label: `${nameOf(s)} (à acheter)`, value: pendingCash / pending.length, color: colorOf(s), striped: true })) : []),
    { key: 'reserve', label: 'Réserve', value: Math.max(0, reserve), color: COLORS.cash, striped: false },
  ].filter((s) => s.value > 0.5);
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;

  return (
    <section id="resume" className="scroll-mt-20 overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="grid grid-cols-1 xl:grid-cols-5">
        <div className="border-b border-line p-5 sm:p-6 xl:col-span-2 xl:border-r xl:border-b-0">
          <div className="text-xs font-medium text-ink-3">
            {hover ? `Valeur le ${new Date(hover.time).toLocaleString('fr-CH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Ce que vaut votre placement'}
          </div>
          <div className="num mt-1 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            <AnimatedMoney value={shown} from={bot.initialCapital} currency={cur} instant={!!hover} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Delta value={pnlPct} size="md" />
            <span className={cx('num font-medium', pnlClass(pnl))}>{fmtSignedMoney(pnl, cur)}</span>
            <span className="text-ink-3">depuis le {fmtDate(bot.createdAt)}</span>
          </div>

          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
            Vous avez confié <b className="font-semibold text-ink">{fmtMoney(bot.initialCapital, cur, 0)}</b> au bot.{' '}
            {positions.length ? (
              <>
                Il en a investi <b className="font-semibold text-ink">{fmtMoney(summary.positionsValue, cur, 0)}</b> dans {positions.length} placement
                {positions.length > 1 ? 's' : ''}
              </>
            ) : (
              <>Il n'a encore rien acheté</>
            )}
            {pending.length > 0 && pendingCash > 0 && (
              <>
                {positions.length ? ' et en achètera ' : ' : il achètera '}
                {pending.length} {positions.length ? 'autre' : 'placement'}
                {pending.length > 1 ? 's' : ''} à l'ouverture de leur bourse
              </>
            )}
            . Il garde <b className="font-semibold text-ink">{fmtMoney(Math.max(0, reserve), cur, 0)}</b> en réserve.{' '}
            {sells === 0 ? "Il n'a rien revendu." : `Il a revendu ${sells} fois.`}
          </p>

          {/* Où est l'argent */}
          <div className="mt-5">
            <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={segments.map((s) => `${s.label} ${fmtNum((s.value / total) * 100, 0)} %`).join(', ')}>
              {segments.map((s, i) => (
                <div
                  key={s.key}
                  className={cx('grow-right h-full', s.striped && 'stripes opacity-60')}
                  style={{ width: `${(s.value / total) * 100}%`, background: s.color, minWidth: 3, animationDelay: `${i * 60}ms` }}
                  title={`${s.label} : ${fmtMoney(s.value, cur)}`}
                />
              ))}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
              {segments.map((s) => (
                <li key={s.key} className="inline-flex items-center gap-1.5">
                  <span className={cx('size-2 rounded-[3px]', s.striped && 'stripes opacity-60')} style={{ background: s.color }} />
                  {s.label} <span className="num text-ink-2">{fmtNum((s.value / total) * 100, 0)} %</span>
                </li>
              ))}
            </ul>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-2">
            <Kpi label="Investi" value={fmtMoney(summary.positionsValue, cur, 0)} />
            <Kpi label="En réserve" value={fmtMoney(summary.cash, cur, 0)} hint={pendingCash > 0 ? `dont ${fmtMoney(pendingCash, cur, 0)} à investir` : undefined} />
            <Kpi label="Frais payés" value={fmtMoney(summary.feesPaid, cur)} hint="banque et taxes" />
            <Kpi
              label="Marge avant la limite"
              value={margin !== null ? fmtMoney(Math.max(0, margin), cur, 0) : '–'}
              hint={lossFloor !== null ? `limite : ${fmtMoney(lossFloor, cur, 0)}` : 'pas de limite'}
              tone={margin !== null && margin < summary.equity * 0.02 ? 'warn' : undefined}
            />
          </dl>
        </div>

        <div className="min-w-0 p-3 pt-4 sm:p-5 xl:col-span-3">
          <div className="mb-1 flex items-center justify-between gap-2 px-2 sm:px-0">
            <h2 className="text-sm font-semibold text-ink">L'évolution de votre argent</h2>
            <span className="text-xs text-ink-3">Glissez dessus pour remonter le temps</span>
          </div>
          <ValueChart
            points={equity ?? []}
            initialCapital={bot.initialCapital}
            currency={cur}
            lossFloor={lossFloor}
            events={trades.map((t) => ({ time: t.time, side: t.side }))}
            height={wide ? 380 : 260}
            onHover={setHover}
          />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-ink-3 sm:px-0">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 border-t border-dashed border-ink-2" /> Votre mise de départ
            </span>
            {lossFloor !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t border-dotted border-down" /> Limite de perte
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="text-up">▲</span> achat <span className="ml-1 text-down">▼</span> vente
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl bg-page/60 px-3 py-2.5">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={cx('num mt-0.5 font-semibold', tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</dd>
      {hint && <dd className="mt-0.5 text-[11px] leading-tight text-ink-3">{hint}</dd>}
    </div>
  );
}

/** Montant qui « défile » jusqu'à sa valeur (de la mise de départ à la valeur actuelle à l'ouverture de la page). */
function AnimatedMoney({ value, from, currency, instant }: { value: number; from: number; currency: string; instant: boolean }) {
  const shown = useTween(value, from, instant ? 0 : 900);
  return <>{fmtMoney(shown, currency)}</>;
}

function useTween(target: number, initial: number, duration: number): number {
  const [value, setValue] = useState(initial);
  const current = useRef(initial);
  useEffect(() => {
    const start = current.current;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (duration <= 0 || reduce || start === target) {
      current.current = target;
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      current.current = start + (target - start) * (1 - (1 - k) ** 3);
      setValue(current.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

// ---------------------------------------------------------------------------
// 2. Ce que le bot a fait, dans l'ordre
// ---------------------------------------------------------------------------

type TimelineItem =
  | { kind: 'start'; time: number }
  | { kind: 'trades'; time: number; trades: Trade[] }
  | { kind: 'log'; time: number; tone: 'warn' | 'info'; title: string; text: string };

/** Les messages du journal qui racontent un moment important (le reste est dans « Pour les curieux »). */
function storyOf(l: LogEntry): Omit<Extract<TimelineItem, { kind: 'log' }>, 'kind' | 'time'> | null {
  if (l.level === 'warn' && !l.symbol && l.message.startsWith('Toutes les actions sont vendues'))
    return { tone: 'warn', title: 'Tout est vendu : votre argent est à l’abri', text: l.message };
  if (l.level === 'warn' && !l.symbol && /limite de perte/i.test(l.message)) return { tone: 'warn', title: 'Limite de perte atteinte', text: l.message };
  if (l.level !== 'info' || l.symbol) return null;
  if (l.message.startsWith('Bot mis en pause')) return { tone: 'info', title: 'Vous avez mis le bot en pause', text: "Il suit toujours les cours, mais n'achète et ne vend plus rien." };
  if (l.message.startsWith('Bot relancé')) return { tone: 'info', title: 'Vous avez relancé le bot', text: 'Il reprend son travail.' };
  if (l.message.startsWith('Nouvelle limite de perte')) return { tone: 'info', title: 'Nouvelle limite de perte', text: l.message };
  return null;
}

function Timeline({ detail, trades, logs, now, pending, perPlacement, analysed, colorOf, nameOf, watchOf, onOpenTrade }: {
  detail: BotDetail;
  trades: Trade[];
  logs: LogEntry[] | null;
  now: number;
  pending: string[];
  perPlacement: number;
  analysed: number | null;
  colorOf: (s: string) => string;
  nameOf: (s: string) => string;
  watchOf: (s: string) => WatchItem | undefined;
  onOpenTrade: (t: Trade) => void;
}) {
  const { bot, lossFloor, summary, protection } = detail;
  const cur = bot.currency;
  const info = PROFILES[bot.profile!.level];

  const items = useMemo(() => {
    const out: TimelineItem[] = [{ kind: 'start', time: bot.createdAt }];
    // Les ordres passés au même moment (par exemple : tous les achats du premier jour) sont regroupés.
    for (const t of trades) {
      const last = out[out.length - 1];
      if (last.kind === 'trades' && t.time - last.time < 10 * 60_000 && last.trades[0].side === t.side && last.trades[0].trigger === t.trigger) last.trades.push(t);
      else out.push({ kind: 'trades', time: t.time, trades: [t] });
    }
    for (const l of logs ?? []) {
      const story = storyOf(l);
      if (story) out.push({ kind: 'log', time: l.time, ...story });
    }
    return out.sort((a, b) => a.time - b.time || (a.kind === 'start' ? -1 : b.kind === 'start' ? 1 : 0));
  }, [trades, logs, bot.createdAt]);

  const days = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const it of items) map.set(zurichDay(it.time), [...(map.get(zurichDay(it.time)) ?? []), it]);
    return [...map.values()];
  }, [items]);

  // À venir : les placements pas encore achetés, regroupés par heure d'ouverture de leur bourse.
  const upcoming = useMemo(() => {
    if (bot.status !== 'running' || protection) return [];
    const groups = new Map<string, string[]>();
    for (const s of pending) {
      const when = whenBuys(watchOf(s), now);
      groups.set(when, [...(groups.get(when) ?? []), s]);
    }
    return [...groups.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.join(), now, bot.status, protection]);

  let step = 0;
  return (
    <Card
      id="historique"
      title={
        <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CalendarClock className="size-5 text-accent-text" aria-hidden /> Ce que le bot a fait
        </span>
      }
      subtitle="Chaque décision, dans l'ordre. Touchez un achat ou une vente pour voir le prix, les frais et la raison."
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-6 xl:order-1">
        {days.map((day) => (
          <div key={zurichDay(day[0].time)}>
            <DayHeader label={dayLabel(day[0].time, now)} count={day.reduce((a, it) => a + (it.kind === 'trades' ? it.trades.length : 1), 0)} />
            <ol className="mt-3">
              {day.map((it) => {
                const delay = Math.min(step++, 12) * 70;
                if (it.kind === 'start')
                  return (
                    <TimelineNode key="start" icon={<Rocket />} tone="accent" time={it.time} delay={delay}>
                      <p className="font-semibold text-ink">Vous avez lancé ce placement avec {fmtMoney(bot.initialCapital, cur, 0)}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-ink-2">
                        Profil <b className="font-semibold" style={{ color: LEVEL_COLORS[bot.profile!.level] }}>{info.name}</b> : le bot a choisi {bot.symbols.length} placements
                        {analysed ? ` parmi ${analysed} analysés` : ''}
                        {info.maxInvestedPct < 100 ? ` et décidé de garder ${100 - info.maxInvestedPct} % de votre argent de côté` : ''}.
                      </p>
                      <a href="#choix" className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-accent-text hover:underline">
                        Voir comment il a choisi <ArrowDown className="size-3.5" aria-hidden />
                      </a>
                    </TimelineNode>
                  );
                if (it.kind === 'log')
                  return (
                    <TimelineNode key={`log-${it.time}`} icon={it.tone === 'warn' ? <ShieldCheck /> : <PauseCircle />} tone={it.tone === 'warn' ? 'warn' : 'neutral'} time={it.time} delay={delay}>
                      <p className="font-semibold text-ink">{it.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{it.text}</p>
                    </TimelineNode>
                  );
                const buy = it.trades[0].side === 'BUY';
                const manual = it.trades[0].trigger === 'manual';
                const total = it.trades.reduce((a, t) => a + t.amount, 0);
                const what = it.trades.length > 1 ? `${it.trades.length} placements` : nameOf(it.trades[0].symbol);
                return (
                  <TimelineNode
                    key={`t-${it.time}`}
                    icon={manual ? <Hand /> : buy ? <ArrowUpRight /> : <ArrowDownRight />}
                    tone={manual ? 'neutral' : buy ? 'up' : 'down'}
                    time={it.time}
                    delay={delay}
                  >
                    <p className="font-semibold text-ink">
                      {manual ? `Vous avez fait vendre ${what}` : `Le bot a ${buy ? 'acheté' : 'vendu'} ${what}`}
                      <span className="num ml-2 whitespace-nowrap text-sm font-medium text-ink-3">
                        {buy ? '−' : '+'}
                        {fmtMoney(total, cur)}
                      </span>
                    </p>
                    {it.trades[0].trigger === 'protection' && <p className="mt-0.5 text-sm text-warn">Vendu pour respecter votre limite de perte.</p>}
                    {manual && <p className="mt-0.5 text-sm text-ink-3">Vente demandée à la main depuis cette page : ce n'est pas une décision du bot.</p>}
                    {buy && it.trades.length > 1 && <p className="mt-0.5 text-sm text-ink-3">Un achat par placement choisi, dès l'ouverture de sa bourse.</p>}
                    <ul className="mt-2 space-y-1.5">
                      {it.trades.map((t) => (
                        <li key={t.id}>
                          <TradeRow trade={t} name={nameOf(t.symbol)} color={colorOf(t.symbol)} currency={cur} onOpen={() => onOpenTrade(t)} />
                        </li>
                      ))}
                    </ul>
                  </TimelineNode>
                );
              })}
            </ol>
          </div>
        ))}

        {/* Ce qui va se passer */}
        <div>
          <DayHeader label="Et ensuite ?" />
          <ol className="mt-3">
            {upcoming.map(([when, symbols]) => (
              <TimelineNode key={when} icon={<Clock />} tone="future" delay={Math.min(step++, 12) * 70}>
                <p className="font-semibold text-ink">
                  Achètera {symbols.map(nameOf).join(', ').replace(/, ([^,]*)$/, ' et $1')} {when}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-2">
                  {watchOf(symbols[0])?.marketOpen ? (
                    <>
                      {symbols.length > 1 ? 'Leur bourse' : 'Sa bourse'} ({exchangeOf(symbols[0])}) vient d'ouvrir : le bot y place environ {fmtMoney(perPlacement, cur, 0)}
                      {symbols.length > 1 ? ' chacun' : ''} à sa prochaine vérification.
                    </>
                  ) : (
                    <>
                      {symbols.length > 1 ? 'Ces placements sont cotés' : 'Ce placement est coté'} sur {exchangeOf(symbols[0])}, fermée pour l'instant. Le bot y placera environ{' '}
                      {fmtMoney(perPlacement, cur, 0)}
                      {symbols.length > 1 ? ' chacun' : ''} dès l'ouverture : il n'achète jamais quand une bourse est fermée, car le prix n'est pas connu.
                    </>
                  )}
                </p>
              </TimelineNode>
            ))}
            <TimelineNode icon={protection ? <ShieldCheck /> : <Hand />} tone="future" last delay={Math.min(step++, 12) * 70}>
              {protection ? (
                <>
                  <p className="font-semibold text-ink">Le bot vend tout pour protéger votre argent, puis se met en pause</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-2">Vous pourrez le relancer quand vous le voudrez, dans « Gérer ce placement ».</p>
                </>
              ) : bot.status === 'paused' ? (
                <>
                  <p className="font-semibold text-ink">En pause : le bot n'achète et ne vend plus rien</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-2">Relancez-le dans « Gérer ce placement » pour qu'il reprenne.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-ink">Le bot garde ses placements et surveille votre argent</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-2">
                    Toutes les minutes, il recalcule ce que vaut votre placement.{' '}
                    {lossFloor !== null ? (
                      <>
                        Il vendra tout seulement s'il descend sous <b className="num font-semibold text-ink">{fmtMoney(lossFloor, cur, 0)}</b> (−{bot.maxLossPct}&nbsp;%) : il reste{' '}
                        <b className="num font-semibold text-ink">{fmtMoney(Math.max(0, summary.equity - lossFloor), cur, 0)}</b> de marge.
                      </>
                    ) : (
                      'Il ne vend pas de lui-même.'
                    )}
                  </p>
                  {lossFloor !== null && (
                    <div className="mt-2 max-w-sm">
                      <LossBar floor={lossFloor} base={lossFloor / (1 - bot.maxLossPct / 100)} value={summary.equity} />
                    </div>
                  )}
                  <a href="#ventes" className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-accent-text hover:underline">
                    Quand le bot vend-il ? <ArrowDown className="size-3.5" aria-hidden />
                  </a>
                </>
              )}
            </TimelineNode>
          </ol>
        </div>
      </div>
      <TimelineSummary trades={trades} currency={cur} feesPaid={summary.feesPaid} />
      </div>
    </Card>
  );
}

/** Le bilan de la chronologie, en quatre chiffres. */
function TimelineSummary({ trades, currency, feesPaid }: { trades: Trade[]; currency: string; feesPaid: number }) {
  const buys = trades.filter((t) => t.side === 'BUY');
  const sells = trades.filter((t) => t.side === 'SELL');
  const realized = sells.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const items = [
    { label: 'Achats', value: String(buys.length), sub: buys.length ? `${fmtMoney(buys.reduce((a, t) => a + t.amount, 0), currency, 0)} investis` : 'aucun pour l’instant' },
    { label: 'Ventes', value: String(sells.length), sub: sells.length ? `${fmtSignedMoney(realized, currency)} encaissés` : 'aucune pour l’instant', tone: sells.length ? pnlClass(realized) : '' },
    { label: 'Frais payés', value: fmtMoney(feesPaid, currency), sub: 'courtage, change, taxes' },
  ];
  return (
    <aside className="xl:order-2" aria-label="Bilan">
      <dl className="grid grid-cols-3 gap-2 xl:sticky xl:top-6 xl:grid-cols-1">
        {items.map((it) => (
          <div key={it.label} className="rounded-xl bg-page/60 px-3 py-2.5 xl:px-4 xl:py-3.5">
            <dt className="text-xs text-ink-3">{it.label}</dt>
            <dd className="num mt-0.5 text-base font-semibold text-ink xl:text-xl">{it.value}</dd>
            <dd className={cx('mt-0.5 text-[11px] leading-tight text-ink-3', it.tone)}>{it.sub}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function DayHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-2">{label}</h3>
      <span className="h-px flex-1 bg-line" />
      {count !== undefined && (
        <span className="text-xs text-ink-3">
          {count} évènement{count > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

const NODE_TONES = {
  accent: 'bg-accent/15 text-accent-text ring-accent/30',
  up: 'bg-up/15 text-up ring-up/30',
  down: 'bg-down/15 text-down ring-down/30',
  warn: 'bg-warn/15 text-warn ring-warn/30',
  neutral: 'bg-raised text-ink-2 ring-line-strong',
  future: 'bg-page text-ink-3',
};

function TimelineNode({ icon, tone, time, last, delay = 0, children }: {
  icon: ReactNode;
  tone: keyof typeof NODE_TONES;
  time?: number;
  last?: boolean;
  delay?: number;
  children: ReactNode;
}) {
  return (
    <li className="tl-item relative flex gap-3.5 pb-5 last:pb-0" style={{ animationDelay: `${delay}ms` }}>
      {!last && (
        <span
          className={cx('tl-line absolute top-10 bottom-1 left-[17px] w-px', tone === 'future' ? 'border-l border-dashed border-line-strong' : 'bg-line-strong')}
          style={{ animationDelay: `${delay + 120}ms` }}
          aria-hidden
        />
      )}
      <span className={cx('relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full ring-1 [&_svg]:size-4', NODE_TONES[tone], tone === 'future' && 'border border-dashed border-line-strong ring-0')}>
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        {time !== undefined && <div className="num mb-0.5 text-xs text-ink-3">{swissTime(time)}</div>}
        {children}
      </div>
    </li>
  );
}

function TradeRow({ trade: t, name, color, currency, onOpen }: { trade: Trade; name: string; color: string; currency: string; onOpen: () => void }) {
  const buy = t.side === 'BUY';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-xl border border-line bg-page/40 px-2.5 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-raised/60 focus-visible:outline-2 focus-visible:outline-accent sm:gap-3 sm:px-3"
    >
      <AssetAvatar name={name} color={color} className="hidden size-9 sm:flex" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-ink">{name}</span>
          <span className="num shrink-0 text-sm font-semibold text-ink">{fmtMoney(t.amount, currency)}</span>
        </span>
        <span className="flex items-baseline justify-between gap-2">
          <span className="num truncate text-xs text-ink-3">
            {fmtQty(t.qty)} parts à {fmtPrice(t.price)} {t.currency}
            <span className="hidden sm:inline"> · frais {fmtMoney(t.fees, currency)}</span>
          </span>
          {!buy && t.pnl !== null ? (
            <span className={cx('num shrink-0 text-xs font-medium', pnlClass(t.pnl))}>{fmtSignedMoney(t.pnl, currency)}</span>
          ) : (
            <span className="shrink-0 text-xs text-ink-3">{buy ? 'payé' : 'reçu'}</span>
          )}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </button>
  );
}

// ---------------------------------------------------------------------------
// 3. Chaque placement
// ---------------------------------------------------------------------------

function HoldingRow({ symbol, name, color, position: p, currency, equity, pending, when, active, onSelect }: {
  symbol: string;
  name: string;
  color: string;
  position: Position | undefined;
  currency: string;
  equity: number;
  pending: boolean;
  when: string;
  active: boolean;
  onSelect: () => void;
}) {
  const kind = assetInfo(symbol)?.kind;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cx(
        'flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        active ? 'border-accent/60 bg-accent/[0.07]' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <AssetAvatar name={name} color={color} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{name}</span>
        <span className="block truncate text-xs text-ink-3">
          {kind ? KIND_LABEL[kind] : symbol}
          {p ? ` · acheté le ${new Date(p.openedAt).toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' })}` : pending ? ' · pas encore acheté' : ' · revendu'}
        </span>
      </span>
      <span className="num shrink-0 text-right">
        {p ? (
          <>
            <span className="block text-sm font-semibold text-ink">{fmtMoney(p.marketValue, currency, 0)}</span>
            <span className={cx('block text-xs font-medium', pnlClass(p.unrealizedPnl))}>
              {fmtPct(p.unrealizedPnlPct)} · {fmtNum((p.marketValue / equity) * 100, 0)} %
            </span>
          </>
        ) : pending ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-medium text-ink-2" title={`Achat ${when}`}>
            <Clock className="size-3" aria-hidden /> en attente
          </span>
        ) : (
          <span className="text-xs text-ink-3">vendu</span>
        )}
      </span>
    </button>
  );
}

function PlacementDetail({ botId, symbol, name, color, position: p, watch, pending, perPlacement, createdAt, currency, equity, volatility, slot, favorite, tradesVersion, now }: {
  botId: number;
  symbol: string;
  name: string;
  color: string;
  position: Position | undefined;
  watch: WatchItem | undefined;
  pending: boolean;
  perPlacement: number;
  createdAt: number;
  currency: string;
  equity: number;
  volatility: number | null;
  slot: { index: number; slot: SlotTrace } | null;
  favorite: boolean;
  tradesVersion: number;
  now: number;
}) {
  const chart = usePolling(() => api.chart(botId, symbol), [botId, symbol, tradesVersion], 120_000);
  const info = assetInfo(symbol);
  const band = volatility !== null ? bandOf(volatility) : null;
  const rank = slot ? slot.slot.candidates.findIndex((c) => c.symbol === symbol) : -1;
  const quote = chart.data?.quote;
  const price = p?.lastPrice ?? quote?.price ?? watch?.price ?? null;
  const quoteCur = p?.currency ?? quote?.currency ?? watch?.currency ?? '';

  return (
    <div id="placement-detail" className="min-w-0 scroll-mt-20 rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:flex-nowrap sm:px-5">
        <div className="flex w-full min-w-0 items-start gap-3 sm:w-auto sm:flex-1">
          <AssetAvatar name={name} color={color} className="size-12 text-sm" />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-tight text-ink">{name}</h3>
            <p className="mt-0.5 text-xs text-ink-3">
              {symbol} · {exchangeOf(symbol).replace(/^la |^le /, '')}
              {info && (
                <>
                  {' · '}
                  <span className="text-ink-2">{KIND_LABEL[info.kind]}</span>
                </>
              )}
            </p>
            {info?.what && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-2">{info.what}</p>}
            {info && <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-3">{KIND_LABEL[info.kind]} : {KIND_HELP[info.kind].charAt(0).toLowerCase() + KIND_HELP[info.kind].slice(1)}</p>}
          </div>
        </div>
        <div className="shrink-0 pl-15 sm:pl-0 sm:text-right">
          <div className="num whitespace-nowrap text-xl font-semibold tracking-tight text-ink">
            {fmtPrice(price)} <span className="text-xs font-normal text-ink-3">{quoteCur}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-3 sm:justify-end">
            <Delta value={watch?.dayChangePct ?? null} /> aujourd'hui
          </div>
        </div>
      </header>

      {/* Les faits : quand, combien, et le résultat */}
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        {p ? (
          <>
            <Fact label="Acheté le" value={fmtDate(p.openedAt)} sub={new Date(p.openedAt).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })} />
            <Fact label="Prix d'achat" value={`${fmtPrice(p.entryPrice)} ${p.currency}`} sub={`${fmtQty(p.qty)} parts`} />
            <Fact label="Vaut aujourd'hui" value={fmtMoney(p.marketValue, currency)} sub={`${fmtNum((p.marketValue / equity) * 100, 0)} % de votre argent`} />
            <Fact
              label="Gain ou perte"
              value={fmtSignedMoney(p.unrealizedPnl, currency)}
              valueClass={pnlClass(p.unrealizedPnl)}
              sub={`${fmtPct(p.unrealizedPnlPct)}, frais compris`}
            />
          </>
        ) : pending ? (
          <div className="col-span-2 flex items-start gap-3 bg-surface px-4 py-3.5 sm:col-span-4">
            <Clock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            <p className="text-sm leading-relaxed text-ink-2">
              <b className="font-semibold text-ink">Pas encore acheté.</b> Le bot l'achètera {whenBuys(watch, now)}, pour environ {fmtMoney(perPlacement, currency, 0)}. En
              attendant, cet argent reste en réserve.
            </p>
          </div>
        ) : (
          <SoldFact trades={chart.data?.trades ?? []} currency={currency} />
        )}
      </div>

      <div className="px-3 pt-4 pb-4 sm:px-5">
        {chart.error && !chart.data && <ErrorBox>{chart.error}</ErrorBox>}
        {!chart.data && !chart.error && <Spinner label="Chargement des cours…" />}
        {chart.data && <AssetChart bars={chart.data.bars} quote={chart.data.quote} trades={chart.data.trades} color={color} createdAt={createdAt} height={300} />}
      </div>

      {/* Pourquoi celui-ci */}
      <div className="border-t border-line px-4 py-4 sm:px-5">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink [&_svg]:size-4">
          <Sparkles className="text-accent-text" aria-hidden /> Pourquoi le bot l'a choisi
        </h4>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {volatility !== null && <AgitationChip volatility={volatility} />}
          {favorite && (
            <Badge tone="warn">
              <Star aria-hidden /> votre choix
            </Badge>
          )}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          {favorite ? (
            'Vous avez choisi cette entreprise dans le questionnaire : le bot l’a prise en premier.'
          ) : slot ? (
            <>
              Il remplit la case n°&nbsp;{slot.index + 1} de votre profil, « {BANDS.find((b) => b.id === slot.slot.band)?.label} ». Parmi les {slot.slot.candidates.length} placements
              de cette catégorie, {slot.slot.nearest ? "aucun n'était disponible : le bot a pris le plus proche." : rank === 0 ? "c'est celui qui avait le meilleur rapport gain / risque l'an passé." : `il avait le meilleur rapport gain / risque parmi ceux encore disponibles.`}{' '}
              <a href="#choix" className="font-medium text-accent-text hover:underline">
                Voir le classement
              </a>
            </>
          ) : band ? (
            `Son niveau d'agitation (${BANDS.find((b) => b.id === band)?.label.toLowerCase()}) correspond à une case de votre profil.`
          ) : (
            'Le bot retrouve ses mesures…'
          )}
        </p>
      </div>
    </div>
  );
}

/** Un placement revendu : qui l'a vendu, quand, à quel prix, et le résultat. */
function SoldFact({ trades, currency }: { trades: Trade[]; currency: string }) {
  const sell = [...trades].filter((t) => t.side === 'SELL').sort((a, b) => b.time - a.time)[0];
  if (!sell) return <div className="col-span-2 bg-surface px-4 py-3.5 text-sm text-ink-2 sm:col-span-4">Ce placement a été revendu.</div>;
  const who =
    sell.trigger === 'manual' ? 'Vous l’avez fait vendre' : sell.trigger === 'protection' ? 'Le bot l’a vendu pour respecter votre limite de perte' : 'Le bot l’a vendu';
  return (
    <>
      <Fact label="Vendu le" value={fmtDate(sell.time)} sub={who} />
      <Fact label="Prix de vente" value={`${fmtPrice(sell.price)} ${sell.currency}`} sub={`${fmtQty(sell.qty)} parts`} />
      <Fact label="Montant reçu" value={fmtMoney(sell.amount, currency)} sub="frais déduits" />
      <Fact label="Résultat" value={fmtSignedMoney(sell.pnl, currency)} valueClass={pnlClass(sell.pnl)} sub={`${fmtPct(sell.pnlPct)}, frais compris`} />
    </>
  );
}

function Fact({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className={cx('num mt-0.5 text-sm font-semibold', valueClass ?? 'text-ink')}>{value}</div>
      {sub && <div className="num mt-0.5 text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Comment le bot a choisi
// ---------------------------------------------------------------------------

function HowItChose({ level, answers, selection, selectionError, trace, symbols, currency, positionSizePct, initialCapital, colorOf, nameOf }: {
  level: RiskLevel;
  answers: Record<string, string>;
  selection: SelectionSnapshot | null;
  selectionError: string | null;
  trace: ReturnType<typeof traceSelection<SelectionMeasure>> | null;
  symbols: string[];
  currency: string;
  positionSizePct: number;
  initialCapital: number;
  colorOf: (s: string) => string;
  nameOf: (s: string) => string;
}) {
  const result = useMemo(() => computeProfile(answers), [answers]);
  const info = PROFILES[level];
  const reserve = Math.max(0, 100 - positionSizePct * symbols.length);
  const displayName = (m: SelectionMeasure) => assetInfo(m.symbol)?.name ?? m.name;
  // Exemple pour expliquer le calcul : le gagnant le plus parlant (plusieurs candidats, gain nettement positif).
  const exampleWinner = trace?.slots
    .filter((s) => s.candidates.length > 1 && !s.nearest)
    .map((s) => s.candidates.find((c) => c.status === 'chosen'))
    .filter((c) => c !== undefined)
    .sort((a, b) => b.perf1y - a.perf1y)[0];
  const prudentCurrency = level <= LOCAL_CURRENCY_MAX_LEVEL;

  return (
    <section id="choix" className="scroll-mt-20 space-y-3">
      <SectionTitle
        icon={<Sparkles />}
        title="Comment le bot a choisi vos placements"
        text="Personne ne lui a dit quoi acheter. Il a suivi quatre étapes, toujours les mêmes, à partir de vos réponses et des vrais cours de la bourse."
      />
      <ol className="space-y-3">
        {/* Étape 1 : le profil */}
        <Step n={1} title={`Vos réponses donnent le profil « ${info.name} »`}>
          <p>
            Le questionnaire mesure trois choses, notées de 1 à 5. Votre profil est <b className="font-semibold text-ink">la plus prudente des trois</b> : on ne prend jamais
            plus de risque que ce que votre situation, votre caractère ou vos connaissances permettent.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Measure label="Votre situation" hint="Quand aurez-vous besoin de l'argent, avez-vous une réserve…" value={result.capacity} decisive={result.capacity === level} />
            <Measure label="Votre rapport au risque" hint="Votre objectif, votre réaction à une baisse…" value={result.tolerance} decisive={result.tolerance === level} />
            <Measure label="Vos connaissances" hint="Votre expérience et le mini-quiz" value={result.knowledgeCap} decisive={result.knowledgeCap === level} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-page/60 px-3.5 py-3">
            <span className="text-sm text-ink-2">Résultat :</span>
            <ProfileBadge level={level} />
            <RiskGauge level={level} className="w-32" />
          </div>
          {result.limitedBy.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-3">
              {result.limitedBy.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <p className="mt-3">
            Chaque profil a des <b className="font-semibold text-ink">cases</b> à remplir, chacune avec un niveau d'agitation. Le vôtre en a {info.slots.length}
            {info.maxInvestedPct < 100 ? `, et garde ${100 - info.maxInvestedPct} % de votre argent en réserve` : ''} :
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {info.slots.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold" style={{ background: `${BAND_COLORS[b]}1f`, color: BAND_COLORS[b] }}>
                <span className="text-[10px] opacity-70">{i + 1}</span> {BANDS.find((x) => x.id === b)?.label}
              </span>
            ))}
            {info.maxInvestedPct < 100 && <span className="inline-flex items-center rounded-lg bg-raised px-2 py-1 text-xs font-semibold text-ink-2">Réserve {100 - info.maxInvestedPct} %</span>}
          </div>
        </Step>

        {/* Étape 2 : les mesures */}
        <Step n={2} title={selection ? `Il a mesuré ${selection.measured.length} placements sur l'année qui précède le ${fmtDate(selection.time)}` : 'Il mesure chaque placement possible'}>
          <p>
            Pour chaque action, fonds ou cryptomonnaie de sa liste, le bot télécharge les cours de l'année passée et calcule deux choses :{' '}
            <b className="font-semibold text-ink">de combien le prix bouge</b> (son agitation, en finance la « volatilité ») et{' '}
            <b className="font-semibold text-ink">combien il a rapporté</b>. Il ne regarde que le passé : personne ne connaît l'avenir.
            {prudentCurrency && ` Comme votre profil est prudent, il ne garde que les placements cotés en ${currency} : pas de risque ni de frais de change.`}
          </p>
          {selectionError && !selection && <ErrorBox>Impossible de retrouver les mesures : {selectionError}</ErrorBox>}
          {!selection && !selectionError && (
            <div className="mt-3 flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center">
              <Spinner label="Le bot retrouve ses mesures (quelques secondes)…" />
            </div>
          )}
          {selection && (
            <div className="mt-3 rounded-xl border border-line bg-page/40 p-2 sm:p-3">
              <p className="mb-2 px-1 text-xs leading-relaxed text-ink-3">
                Chaque point est un placement. <b className="font-semibold text-ink-2">Plus il est à droite, plus il bouge</b> ;{' '}
                <b className="font-semibold text-ink-2">plus il est haut, plus il a rapporté</b>. Les zones colorées sont celles de votre profil. Touchez un point pour le détail.
              </p>
              <RiskMap
                measured={selection.measured}
                chosen={symbols}
                removed={selection.removed}
                level={level}
                colorOf={colorOf}
                displayName={displayName}
                height={360}
              />
            </div>
          )}
        </Step>

        {/* Étape 3 : la règle de choix */}
        <Step n={3} title="Dans chaque case, il prend le meilleur rapport gain / risque">
          <p>
            Pour chaque case, le bot regarde les placements de la bonne agitation et prend celui qui a{' '}
            <b className="font-semibold text-ink">le plus rapporté pour chaque point d'agitation</b> : gain de l'année ÷ agitation.
            {exampleWinner && (
              <>
                {' '}
                Exemple : {displayName(exampleWinner)} a rapporté {fmtPct(exampleWinner.perf1y, 1)} en bougeant de {fmtNum(exampleWinner.volatility, 1)} % sur l'année, soit{' '}
                {fmtNum(exampleWinner.quality, 2)}.
              </>
            )}{' '}
            Il ne prend jamais plus de <b className="font-semibold text-ink">deux placements du même secteur</b>, pour ne pas mettre tous ses œufs dans le même panier.
          </p>
          {trace ? (
            <div className="mt-3 space-y-2.5">
              {trace.favorites.length > 0 && (
                <div className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3.5 py-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-warn [&_svg]:size-3.5">
                    <Star aria-hidden /> Vos choix, pris en premier
                  </div>
                  <p className="mt-1 text-sm text-ink">{trace.favorites.map(nameOf).join(', ')}</p>
                </div>
              )}
              {trace.slots.map((slot, i) => (
                <SlotCard key={i} index={i} slot={slot} removed={selection?.removed ?? []} colorOf={colorOf} nameOf={nameOf} />
              ))}
            </div>
          ) : (
            !selectionError && <div className="mt-3 h-40 animate-pulse rounded-xl bg-raised/50" />
          )}
        </Step>

        {/* Étape 4 : la répartition */}
        <Step n={4} title="Il répartit votre argent" last>
          <p>
            Chaque placement reçoit la même part : {positionSizePct}&nbsp;% de votre argent (environ {fmtMoney((initialCapital * positionSizePct) / 100, currency, 0)}).
            {reserve > 0 && ` Le reste (${reserve} %) reste en réserve, sans jamais être investi : c'est votre coussin de sécurité.`}
          </p>
          <div className="mt-3 space-y-1.5">
            {symbols.map((s, i) => (
              <ShareBar key={s} label={nameOf(s)} pct={positionSizePct} color={colorOf(s)} delay={i * 80} amount={fmtMoney((initialCapital * positionSizePct) / 100, currency, 0)} />
            ))}
            {reserve > 0 && <ShareBar label="Réserve" pct={reserve} color={COLORS.cash} delay={symbols.length * 80} amount={fmtMoney((initialCapital * reserve) / 100, currency, 0)} />}
          </div>
        </Step>
      </ol>
    </section>
  );
}

function Step({ n, title, last, children }: { n: number; title: string; last?: boolean; children: ReactNode }) {
  return (
    <li className="relative flex gap-3.5 sm:gap-4">
      {!last && <span className="absolute top-11 bottom-[-12px] left-[17px] w-px bg-line-strong sm:left-[19px]" aria-hidden />}
      <span className="relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white shadow-[0_0_0_4px_var(--color-page)] sm:size-10">
        {n}
      </span>
      <div className="min-w-0 flex-1 rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-ink-2 sm:p-5">
        <h3 className="mb-1.5 text-base font-semibold leading-snug text-ink">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function Measure({ label, hint, value, decisive }: { label: string; hint: string; value: number; decisive: boolean }) {
  return (
    <div className={cx('rounded-xl border px-3 py-2.5', decisive ? 'border-accent/50 bg-accent/[0.07]' : 'border-line bg-page/40')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{label}</span>
        <span className="num text-sm font-semibold" style={{ color: LEVEL_COLORS[value as RiskLevel] }}>
          {value}/5
        </span>
      </div>
      <RiskGauge level={value as RiskLevel} className="mt-2" />
      <p className="mt-1.5 text-[11px] leading-snug text-ink-3">{hint}</p>
      {decisive && <p className="mt-1 text-[11px] font-semibold text-accent-text">C'est elle qui fixe votre profil</p>}
    </div>
  );
}

const STATUS_TEXT = {
  chosen: 'choisi',
  behind: 'moins bon rapport',
  taken: 'déjà pris ailleurs',
  sector: 'secteur déjà pris 2 fois',
} as const;

function SlotCard({ index, slot, removed, colorOf, nameOf }: { index: number; slot: SlotTrace; removed: string[]; colorOf: (s: string) => string; nameOf: (s: string) => string }) {
  const [open, setOpen] = useState(false);
  const band = BANDS.find((b) => b.id === slot.band)!;
  const chosen = slot.candidates.find((c) => c.status === 'chosen');
  const wasRemoved = slot.chosen !== null && removed.includes(slot.chosen);
  const shown = open ? slot.candidates : slot.candidates.slice(0, 3);
  const best = Math.max(0.01, ...slot.candidates.map((c) => c.quality));
  const name = (s: string) => nameOf(s);
  return (
    <div className="rounded-xl border border-line bg-page/40 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink-3">Case {index + 1}</span>
          <span className="rounded-md px-1.5 py-0.5 text-xs font-semibold" style={{ background: `${BAND_COLORS[slot.band]}1f`, color: BAND_COLORS[slot.band] }}>
            {band.label}
          </span>
          <span className="text-xs text-ink-3">
            {slot.candidates.length} candidat{slot.candidates.length > 1 ? 's' : ''}
          </span>
        </div>
        {slot.chosen && (
          <span className={cx('inline-flex items-center gap-1.5 text-sm font-semibold', wasRemoved ? 'text-ink-3 line-through' : 'text-ink')}>
            <span className="size-2 rounded-full" style={{ background: wasRemoved ? COLORS.ink3 : colorOf(slot.chosen) }} />
            {name(slot.chosen)}
          </span>
        )}
      </div>
      {slot.nearest && slot.chosen && (
        <p className="mt-2 text-xs text-ink-3">
          Aucun placement « {band.label.toLowerCase()} » n'était disponible : le bot a pris le plus proche ({name(slot.chosen)}).
        </p>
      )}
      {wasRemoved && <p className="mt-2 text-xs text-warn">Vous l'avez retiré avant de lancer le bot : son argent reste en réserve.</p>}
      {shown.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {shown.map((c) => (
            <li key={c.symbol} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
              <span className={cx('truncate', c.status === 'chosen' ? 'font-semibold text-ink' : 'text-ink-2')}>{name(c.symbol)}</span>
              <span className="col-span-2 row-start-2 h-2 overflow-hidden rounded-full bg-raised sm:col-span-1 sm:row-start-auto">
                <span
                  className="grow-right block h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (Math.max(0, c.quality) / best) * 100)}%`,
                    background: c.status === 'chosen' ? (wasRemoved ? COLORS.ink3 : colorOf(c.symbol)) : '#4a4a52',
                  }}
                />
              </span>
              <span className="num text-right text-ink-3">
                <span className={c.status === 'chosen' ? 'font-semibold text-ink' : ''}>{fmtNum(c.quality, 2)}</span>
                <span className={cx('ml-2 hidden sm:inline', c.status === 'chosen' ? 'text-up' : c.status === 'behind' ? 'text-ink-3' : 'text-warn')}>{STATUS_TEXT[c.status]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {slot.candidates.length > 3 && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-2 text-xs font-medium text-accent-text hover:underline">
          {open ? 'Réduire' : `Voir les ${slot.candidates.length - 3} autres`}
        </button>
      )}
      {chosen && (
        <p className="mt-2 text-[11px] leading-snug text-ink-3">
          {name(chosen.symbol)} : {fmtPct(chosen.perf1y, 1)} sur l'année étudiée, en bougeant d'environ ±{fmtNum(dailyMove(chosen.volatility), 1)} % par jour.
        </p>
      )}
    </div>
  );
}

function ShareBar({ label, pct, color, amount, delay }: { label: string; pct: number; color: string; amount: string; delay: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-3 text-xs sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto]">
      <span className="truncate text-ink-2">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-raised">
        <span className="grow-right block h-full rounded-full" style={{ width: `${pct}%`, background: color, animationDelay: `${delay}ms` }} />
      </span>
      <span className="num w-24 text-right text-ink">
        {pct} % <span className="text-ink-3">· {amount}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Quand le bot vend
// ---------------------------------------------------------------------------

function WhenItSells({ maxLossPct, lossFloor, equity, currency, paused, sells }: {
  maxLossPct: number;
  lossFloor: number | null;
  equity: number;
  currency: string;
  paused: boolean;
  sells: number;
}) {
  return (
    <section id="ventes" className="scroll-mt-20 space-y-3">
      <SectionTitle
        icon={<ShieldCheck />}
        title="Quand le bot revend-il ?"
        text={sells === 0 ? "Pour l'instant, il n'a rien revendu. Voici les seules situations où il le fera." : `Il a revendu ${sells} fois. Voici les seules situations où il revend.`}
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <RuleCard icon={<TriangleAlert />} tone="down" title={maxLossPct > 0 ? `Si votre placement perd plus de ${maxLossPct} %` : 'Pas de limite de perte'}>
          {lossFloor !== null ? (
            <>
              <p>
                C'est votre <b className="font-semibold text-ink">limite de perte</b>, fixée d'après vos réponses. Si la valeur totale descend sous{' '}
                <b className="num font-semibold text-ink">{fmtMoney(lossFloor, currency, 0)}</b>, le bot vend tout dès que les bourses ouvrent, puis se met en pause : le
                reste de votre argent est à l'abri.
              </p>
              <div className="mt-3">
                <LossBar floor={lossFloor} base={lossFloor / (1 - maxLossPct / 100)} value={equity} />
              </div>
              <p className="num mt-2 text-xs text-ink-3">
                Aujourd'hui : {fmtMoney(equity, currency, 0)}, soit {fmtMoney(Math.max(0, equity - lossFloor), currency, 0)} au-dessus de la limite.
              </p>
            </>
          ) : (
            <p>Ce placement n'a pas de limite de perte : le bot ne vend pas de lui-même.</p>
          )}
        </RuleCard>
        <RuleCard icon={<Hand />} tone="accent" title="Si vous le décidez">
          <p>
            Vous gardez la main : vous pouvez {paused ? 'relancer le bot' : 'mettre le bot en pause'} ou tout recommencer, plus bas dans « Gérer ce placement ». Le bot,
            lui, ne vend jamais par peur ou par envie.
          </p>
        </RuleCard>
        <RuleCard icon={<Play />} tone="up" title="Jamais pour « encaisser un gain »">
          <p>
            Il ne cherche pas à acheter bas et revendre haut. Nos tests sur 4 ans de vrais cours, frais réels compris, montrent que pour un petit investisseur ces allers-retours
            coûtent plus en frais qu'ils ne rapportent : le bot choisit bien, puis il garde.
          </p>
          <Link to="/apprendre" className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-accent-text hover:underline">
            Voir les résultats des tests <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </RuleCard>
      </div>
    </section>
  );
}

function RuleCard({ icon, tone, title, children }: { icon: ReactNode; tone: 'down' | 'up' | 'accent'; title: string; children: ReactNode }) {
  const tones = { down: 'bg-down/12 text-down', up: 'bg-up/12 text-up', accent: 'bg-accent/15 text-accent-text' };
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-ink-2 sm:p-5">
      <span className={cx('flex size-9 items-center justify-center rounded-xl [&_svg]:size-[18px]', tones[tone])}>{icon}</span>
      <h3 className="mt-3 text-base font-semibold leading-snug text-ink">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
