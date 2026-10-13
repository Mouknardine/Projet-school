// Dashboard d'un bot réglé à la main (mode expert) : un résumé en phrases, la stratégie expliquée, ce que le bot possède,
// ses trades avec leurs raisons, le graphique des cours, les statistiques et le journal.
// Un placement créé avec le questionnaire a sa propre page, pensée pour les débutants (PlacementView).

import { ArrowLeft, ChevronDown, Clock, Download, ShieldCheck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Bot, BotDetail, BotSummary, Position, WatchItem } from '../../../shared/types.ts';
import { assetInfo } from '../../../shared/profile.ts';
import { useAppData } from '../App.tsx';
import { Journal, ManageCard, Stats, StrategyCard } from '../components/botParts.tsx';
import { AllocationBar, COLORS, PerformanceChart, PriceChart, RiskTrack, SERIES, Sparkline } from '../components/charts.tsx';
import { TradesTable } from '../components/TradesTable.tsx';
import { Badge, Button, Card, cx, Delta, ErrorBox, LiveDot, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, fmtRelative, fmtSession, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { useNow, usePolling } from '../lib/usePolling.ts';
import { PlacementView } from './PlacementView.tsx';

const INTERVAL_LABEL: Record<string, string> = { '5m': '5 minutes', '15m': '15 minutes', '1h': '1 heure', '1d': '1 jour' };

/** Les parties de la page, pour s'y rendre directement depuis le sommaire. */
const SECTIONS = [
  { id: 'resume', label: 'Résumé' },
  { id: 'profil', label: 'Sa stratégie' },
  { id: 'portefeuille', label: "Ce qu'il possède" },
  { id: 'graphique', label: 'Graphique des achats' },
  { id: 'trades', label: 'Ses décisions' },
  { id: 'details', label: 'Pour les curieux' },
  { id: 'gerer', label: 'Gérer' },
];

export function BotPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { config } = useAppData();
  const now = useNow(5000);

  const detail = usePolling(() => api.bot(id), [id], 10_000);
  const equity = usePolling(() => api.equity(id), [id], 60_000);
  const trades = usePolling(() => api.trades(id), [id], 15_000);
  const logs = usePolling(() => api.logs(id), [id], 15_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<BotDetail | void>) => {
    setBusy(label);
    setActionError(null);
    try {
      const d = await fn();
      if (d) detail.setData(d);
      else detail.reload();
      equity.reload();
      trades.reload();
      logs.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await api.deleteBot(id);
      navigate('/');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  if (detail.error && !detail.data) return <ErrorBox>{detail.error}</ErrorBox>;
  if (!detail.data) return <Spinner />;

  // Placement créé avec le questionnaire : la page pensée pour les débutants.
  if (detail.data.bot.profile)
    return (
      <PlacementView
        detail={detail.data}
        equity={equity.data}
        trades={trades.data}
        logs={logs.data}
        now={now}
        busy={busy}
        run={run}
        remove={remove}
        actionError={actionError}
        tickSeconds={config.tickSeconds}
        brokerName={config.brokers?.find((b) => b.id === detail.data?.bot.broker)?.name}
      />
    );

  const { bot, summary, positions, strategy, watchlist, protection } = detail.data;
  const broker = config.brokers?.find((b) => b.id === bot.broker);
  const cur = bot.currency;
  const colorOf = (s: string) => SERIES[Math.max(0, bot.symbols.indexOf(s)) % SERIES.length];
  const nameOf = (s: string) => watchlist.find((w) => w.symbol === s)?.name ?? null;
  const anyOpen = watchlist.some((w) => w.marketOpen);
  const selected = symbol && bot.symbols.includes(symbol) ? symbol : bot.symbols[0];

  const status =
    bot.status === 'paused'
      ? { tone: 'warn' as const, label: 'En pause', text: "Le bot est en pause : il suit toujours les cours, mais il n'achète et ne vend plus rien." }
      : anyOpen
        ? { tone: 'up' as const, label: 'Actif · bourse ouverte', text: 'La bourse est ouverte : le bot surveille les cours en direct et peut acheter ou vendre à tout moment.' }
        : { tone: 'neutral' as const, label: 'Actif · bourse fermée', text: 'La bourse est fermée : le bot attend la prochaine séance pour acheter ou vendre.' };

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
            <LiveDot on={bot.status === 'running' && anyOpen} />
            {status.label}
          </Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">{status.text}</p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-3">
          <Clock className="size-3.5" aria-hidden /> Dernière analyse {fmtRelative(bot.lastTickAt, now)} · une analyse toutes les{' '}
          {config.tickSeconds} secondes
        </p>
      </div>

      {/* Sommaire : chaque partie de la page, nommée clairement */}
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
              {fmtMoney(protection.base, cur)}. Comme prévu, le bot {positions.length ? 'vend toutes ses actions dès que leur bourse ouvre' : 'a tout vendu pour protéger votre argent'}
              {bot.status === 'paused' ? ' et s’est mis en pause. Vous pouvez le relancer plus bas, dans « Gérer ».' : '.'}
            </p>
          </div>
        </div>
      )}
      {bot.lastError && <ErrorBox>Problème lors de la dernière analyse : {bot.lastError}</ErrorBox>}

      {/* Résumé + évolution */}
      <div className="grid grid-cols-1 gap-5 lg:gap-6 xl:grid-cols-5">
        <Summary bot={bot} summary={summary} positions={positions} marketOpen={anyOpen} className="xl:col-span-2" />
        <Card className="xl:col-span-3">
          <PerformanceChart points={equity.data ?? []} initialCapital={bot.initialCapital} currency={cur} height={300} title="Évolution de la valeur du bot" />
        </Card>
      </div>

      <div id="profil" className="scroll-mt-20">
        <StrategyCard bot={bot} strategy={strategy} tickSeconds={config.tickSeconds} broker={broker} />
      </div>

      {/* Portefeuille */}
      <Card
        id="portefeuille"
        title="Ce que le bot possède en ce moment"
        subtitle={`${fmtMoney(summary.equity, cur)} au total : ${fmtMoney(summary.positionsValue, cur)} en actions et ${fmtMoney(summary.cash, cur)} en liquidités`}
      >
        <AllocationBar
          currency={cur}
          items={[
            ...positions.map((p) => ({ key: p.symbol, label: p.symbol, value: p.marketValue, color: colorOf(p.symbol) })),
            { key: 'cash', label: 'Liquidités', value: summary.cash, color: COLORS.cash },
          ]}
        />
        <div className="mt-5 border-t border-line pt-4">
          {positions.length === 0 ? (
            <div className="flex flex-col items-center px-2 py-6 text-center">
              <div className="mb-3 rounded-xl bg-raised p-3 text-ink-3 [&_svg]:size-5">
                <Wallet aria-hidden />
              </div>
              <p className="text-sm font-semibold text-ink">
                {summary.tradesCount === 0 ? "Pourquoi le bot n'a encore rien acheté ?" : "Le bot ne possède aucune action pour l'instant"}
              </p>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-2">
                {!anyOpen
                  ? `La bourse est fermée en ce moment${fmtSession(watchlist.find((w) => w.session)?.session) ? ` (elle est ${fmtSession(watchlist.find((w) => w.session)?.session)})` : ''}. Le bot n'achète et ne vend que pendant les heures d'ouverture : il reprendra à la prochaine séance.`
                  : strategy.idle || "Sa stratégie n'a pas encore donné de signal d'achat : le bot attend le bon moment."}
              </p>
              <a href="#graphique" className="mt-3 text-sm font-medium text-accent-text hover:underline">
                Voir ce qu'il pense de chaque action ↓
              </a>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {positions.map((p) => (
                <li key={p.symbol}>
                  <PositionCard
                    position={p}
                    name={nameOf(p.symbol)}
                    color={colorOf(p.symbol)}
                    currency={cur}
                    now={now}
                    disabled={!!busy}
                    onSell={() => {
                      if (confirm(`Vendre maintenant toutes les actions ${p.symbol} au cours actuel ?`)) run('close', () => api.closePosition(bot.id, p.symbol));
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Actions suivies + graphique */}
      <section id="graphique" className="scroll-mt-20 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Où le bot a acheté et vendu</h2>
          <p className="mt-0.5 text-xs text-ink-3">Chaque placement suivi par le bot, son cours et ce que le bot en pense. Touchez-en un pour voir son graphique.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {watchlist.map((w) => (
            <WatchCard
              key={w.symbol}
              now={now}
              item={w}
              color={colorOf(w.symbol)}
              held={positions.some((p) => p.symbol === w.symbol)}
              active={w.symbol === selected}
              onSelect={() => {
                setSymbol(w.symbol);
                document.getElementById('graphique-cours')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          ))}
        </div>
        <SymbolChart
          botId={bot.id}
          symbols={bot.symbols}
          symbol={selected}
          onSymbol={setSymbol}
          tradesVersion={summary.tradesCount}
          interval={bot.interval}
        />
      </section>

      {/* Trades */}
      <Card
        id="trades"
        title="Ses décisions : chaque achat et chaque vente, expliqués"
        subtitle="Touchez une décision pour lire l'explication complète et voir les frais."
        actions={
          <a
            href={api.csvUrl(bot.id)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-raised hover:text-ink"
          >
            <Download className="size-3.5" aria-hidden /> Télécharger (Excel)
          </a>
        }
      >
        {trades.data ? (
          <TradesTable
            trades={trades.data}
            currency={cur}
            pageSize={5}
            colorOf={colorOf}
            context={{ strategy, stopLossPct: bot.stopLossPct, takeProfitPct: bot.takeProfitPct, names: Object.fromEntries(watchlist.map((w) => [w.symbol, w.name])) }}
          />
        ) : (
          <Spinner />
        )}
      </Card>

      {/* Détails techniques, repliés : utiles pour comprendre en profondeur, mais pas nécessaires pour suivre son placement. */}
      <details id="details" className="group scroll-mt-20 rounded-2xl border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold text-ink">Pour les curieux</span>
            <span className="mt-0.5 block text-xs text-ink-3">Statistiques détaillées, règle exacte de la stratégie et journal de tout ce que le bot a fait.</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-5 border-t border-line p-3 sm:p-5">
          <Stats bot={bot} summary={summary} brokerName={broker?.name} />
          <Journal logs={logs.data} />
        </div>
      </details>

      <ManageCard bot={bot} busy={busy} onRun={run} onDelete={remove} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Résumé en phrases
// ---------------------------------------------------------------------------

function Summary({ bot, summary, positions, marketOpen, className }: {
  bot: Bot;
  summary: BotSummary;
  positions: Position[];
  marketOpen: boolean;
  className?: string;
}) {
  const cur = bot.currency;
  const flat = Math.abs(summary.pnl) < 0.005;
  const vs = summary.benchmarkPnlPct !== null ? summary.pnlPct - summary.benchmarkPnlPct : null;
  const invested = summary.equity > 0 ? (summary.positionsValue / summary.equity) * 100 : 0;
  const verdict = vs === null ? null : vs > 0.05 ? 'mieux' : vs < -0.05 ? 'moins bien' : 'à peu près aussi bien';

  return (
    <Card id="resume" title="En bref" className={className}>
      <div className="text-xs text-ink-3">Valeur du bot aujourd'hui</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="num text-3xl font-semibold tracking-tight text-ink">{fmtMoney(summary.equity, cur)}</span>
        <Delta value={summary.pnlPct} size="md" />
      </div>

      <div className="mt-4 space-y-2.5 text-[15px] leading-relaxed text-ink-2">
        <p>
          Le bot a démarré le {fmtDate(bot.createdAt)} avec <b className="font-semibold text-ink">{fmtMoney(bot.initialCapital, cur)}</b> d'argent fictif.{' '}
          {flat ? (
            "Pour l'instant, il n'a rien gagné ni perdu."
          ) : (
            <>
              Il a{' '}
              <b className={cx('font-semibold', pnlClass(summary.pnl))}>
                {summary.pnl > 0 ? 'gagné' : 'perdu'} {fmtMoney(Math.abs(summary.pnl), cur)}
              </b>{' '}
              ({fmtPct(summary.pnlPct)}).
            </>
          )}
        </p>
        {summary.benchmarkPnlPct !== null && verdict && (
          <p>
            Si on avait simplement acheté ses actions au départ et attendu (« acheter et garder »), on aurait {fmtPct(summary.benchmarkPnlPct)}. Le bot fait donc{' '}
            <b className={cx('font-semibold', verdict === 'mieux' ? 'text-up' : verdict === 'moins bien' ? 'text-down' : 'text-ink')}>{verdict}</b>.
          </p>
        )}
        <p>
          {positions.length === 0 ? (
            <>
              En ce moment, il ne possède aucune action : tout l'argent ({fmtMoney(summary.cash, cur)}) attend en liquidités.
            </>
          ) : (
            <>
              En ce moment, il possède {positions.length} des {bot.symbols.length} actions qu'il surveille ({fmtNum(invested, 0)} % de l'argent) et garde{' '}
              {fmtMoney(summary.cash, cur)} en liquidités.
            </>
          )}{' '}
          {summary.tradesCount === 0 ? (
            <>
              Il n'a encore rien acheté :{' '}
              {bot.status === 'paused'
                ? 'il est en pause.'
                : marketOpen
                  ? "il attend le bon moment selon sa stratégie (voir « Ce qu'il possède » plus bas)."
                  : 'la bourse est fermée, il attend la prochaine séance.'}
            </>
          ) : (
            <>
              Il a passé {summary.tradesCount} ordre{summary.tradesCount > 1 ? 's' : ''} d'achat ou de vente.
            </>
          )}
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Une action possédée
// ---------------------------------------------------------------------------

function PositionCard({ position: p, name, color, currency, now, disabled, onSell }: {
  position: Position;
  name: string | null;
  color: string;
  currency: string;
  now: number;
  disabled: boolean;
  onSell: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-page/40 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
            {p.symbol}
          </div>
          <div className="truncate text-xs text-ink-3">{name ?? ''}</div>
        </div>
        <div className="text-right">
          <div className={cx('num text-sm font-semibold', pnlClass(p.unrealizedPnl))}>{fmtSignedMoney(p.unrealizedPnl, currency)}</div>
          <Delta value={p.unrealizedPnlPct} className="mt-0.5" />
        </div>
      </div>
      <p className="num mt-3 text-sm leading-relaxed text-ink-2">
        Le bot en a acheté {fmtQty(p.qty)} à {fmtPrice(p.entryPrice)}&nbsp;{p.currency}&nbsp;; le cours est maintenant à {fmtPrice(p.lastPrice)}&nbsp;{p.currency}. Valeur&nbsp;:{' '}
        <b className="font-semibold text-ink">{fmtMoney(p.marketValue, currency)}</b>
        {p.currency !== currency && (
          <span className="text-ink-3">
            {' '}
            (1&nbsp;{p.currency}&nbsp;=&nbsp;{fmtNum(p.lastFx, 4)}&nbsp;{currency}, contre {fmtNum(p.entryFx, 4)} à l'achat)
          </span>
        )}
        .
      </p>
      <PnlBreakdown position={p} currency={currency} />
      <div className="mt-3">
        <div className="mb-1.5 text-xs text-ink-3">Où en est le cours par rapport aux ventes automatiques :</div>
        <RiskTrack stop={p.stopLossPrice} target={p.takeProfitPrice} entry={p.entryPrice} price={p.lastPrice ?? p.entryPrice} className="w-full" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-xs text-ink-3">Achetée {fmtRelative(p.openedAt, now)}</span>
        <Button className="h-8 px-2.5 text-xs" disabled={disabled} onClick={onSell}>
          Vendre maintenant
        </Button>
      </div>
    </div>
  );
}

/** D'où vient le gain ou la perte d'une position : le cours, la monnaie et les frais d'achat. */
function PnlBreakdown({ position: p, currency }: { position: Position; currency: string }) {
  const price = p.lastPrice ?? p.entryPrice;
  const priceEffect = (price / p.entryPrice - 1) * 100;
  const fxEffect = (p.lastFx / p.entryFx - 1) * 100;
  const buyFees = p.costBasis - p.qty * p.entryPrice * p.entryFx;
  const foreign = p.currency !== currency;
  return (
    <div className="num mt-2 grid grid-cols-3 gap-1.5 text-center text-xs">
      <div className="rounded-lg bg-page/60 px-2 py-1.5">
        <div className="text-ink-3">Cours</div>
        <div className={cx('font-semibold', pnlClass(priceEffect))}>{fmtPct(priceEffect)}</div>
      </div>
      <div className="rounded-lg bg-page/60 px-2 py-1.5">
        <div className="text-ink-3">{foreign ? `${p.currency} en ${currency}` : 'Change'}</div>
        <div className={cx('font-semibold', foreign ? pnlClass(fxEffect) : 'text-ink-3')}>{foreign ? fmtPct(fxEffect) : 'aucun'}</div>
      </div>
      <div className="rounded-lg bg-page/60 px-2 py-1.5">
        <div className="text-ink-3">Frais d'achat</div>
        <div className={cx('font-semibold', buyFees > 0.005 ? 'text-down' : 'text-ink-3')}>{buyFees > 0.005 ? `−${fmtMoney(buyFees, currency)}` : '0'}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions surveillées et graphique
// ---------------------------------------------------------------------------

function WatchCard({ item, color, held, active, now, onSelect }: {
  item: WatchItem;
  color: string;
  held: boolean;
  active: boolean;
  now: number;
  onSelect: () => void;
}) {
  const hours = fmtSession(item.session);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cx(
        'group rounded-2xl border bg-surface p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        active ? 'border-accent/60' : 'border-line hover:border-line-strong',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="size-2 rounded-full" style={{ background: color }} />
            <span className="font-semibold text-ink">{item.symbol}</span>
            {held && <Badge tone="accent">le bot en possède</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-3">{item.name ?? '—'}</div>
        </div>
        <div className="text-right">
          <Delta value={item.dayChangePct} />
          <div className="mt-0.5 text-[11px] text-ink-3">aujourd'hui</div>
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-lg font-semibold tracking-tight text-ink">
          {fmtPrice(item.price)} <span className="text-xs font-normal text-ink-3">{item.currency}</span>
        </div>
        <Sparkline values={item.spark} base={item.spark[0]} className="h-9 w-28" />
      </div>
      <div className="mt-3 rounded-lg bg-page/60 px-3 py-2.5 text-xs leading-relaxed">
        <div className="mb-0.5 font-semibold text-ink-2">Ce que le bot en pense</div>
        {item.marketOpen === false && (
          <p className="text-ink-2">
            Bourse fermée{hours ? ` (elle est ${hours})` : ''} : le bot attend la prochaine séance.
          </p>
        )}
        {item.lastAnalysis ? (
          <p className="mt-0.5 line-clamp-5 text-ink-3">
            {item.marketOpen === false ? 'Dernière analyse : ' : ''}
            {item.lastAnalysis.text} <span className="whitespace-nowrap text-ink-3/80">({fmtRelative(item.lastAnalysis.time, now)})</span>
          </p>
        ) : (
          item.marketOpen !== false && <p className="text-ink-3">Le bot donnera son avis à la fin de la prochaine bougie.</p>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <LiveDot on={item.marketOpen} /> {item.marketOpen ? 'Bourse ouverte' : 'Bourse fermée'}
        </span>
        <span>
          depuis le départ du bot <span className={pnlClass(item.sinceStartPct)}>{fmtPct(item.sinceStartPct)}</span>
        </span>
      </div>
    </button>
  );
}

function SymbolChart({ botId, symbols, symbol, onSymbol, tradesVersion, interval }: {
  botId: number;
  symbols: string[];
  symbol: string;
  onSymbol: (s: string) => void;
  tradesVersion: number;
  interval: string;
}) {
  const chart = usePolling(() => api.chart(botId, symbol), [botId, symbol, tradesVersion], 60_000);
  const [showCalc, setShowCalc] = useState(true);
  const overlays = showCalc ? (chart.data?.overlays ?? []) : [];
  const label = (s: string) => assetInfo(s)?.name ?? s;
  const q = chart.data?.quote;
  const change = q && q.previousClose ? (q.price / q.previousClose - 1) * 100 : null;

  return (
    <div id="graphique-cours" className="scroll-mt-20 min-w-0 rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-4 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">Le prix de {label(symbol)} et les achats / ventes du bot</h3>
          {q ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-2xl font-semibold tracking-tight text-ink">
                {fmtPrice(q.price)} <span className="text-sm font-normal text-ink-3">{q.currency}</span>
              </span>
              <Delta value={change} />
              <span className="text-xs text-ink-3">aujourd'hui</span>
              <span className="truncate text-xs text-ink-3">
                {q.name} · {q.exchange}
              </span>
            </div>
          ) : (
            <div className="mt-2 h-8" />
          )}
        </div>
        {symbols.length > 1 && <Segmented value={symbol} onChange={onSymbol} items={symbols.map((s) => ({ id: s, label: label(s) }))} />}
      </header>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pb-2">
        <p className="max-w-3xl text-xs leading-relaxed text-ink-3">
          Chaque bâton résume le prix sur {INTERVAL_LABEL[interval]} : <span className="text-up">vert</span> si le prix a monté,{' '}
          <span className="text-down">rouge</span> s'il a baissé. Les flèches montrent les <b className="font-semibold text-ink-2">achats (▲ en dessous)</b> et
          les <b className="font-semibold text-ink-2">ventes (▼ au-dessus)</b>.
          {showCalc && ' Les lignes de couleur sont les calculs que le bot utilise pour décider.'}
        </p>
        {(chart.data?.overlays.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setShowCalc(!showCalc)}
            aria-pressed={showCalc}
            className="inline-flex h-8 shrink-0 items-center rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-raised hover:text-ink"
          >
            {showCalc ? 'Masquer les calculs du bot' : 'Voir les calculs du bot'}
          </button>
        )}
      </div>
      <div className="px-3 pb-4 sm:px-5">
        {chart.error && !chart.data && <ErrorBox>{chart.error}</ErrorBox>}
        {!chart.data && !chart.error && <Spinner />}
        {chart.data && (
          <PriceChart
            bars={chart.data.bars}
            overlays={overlays}
            series={chart.data.series}
            trades={chart.data.trades}
            interval={chart.data.interval}
            height={overlays.some((o) => o.pane === 'oscillator') ? 440 : 380}
            initialBars={120}
          />
        )}
      </div>
    </div>
  );
}

