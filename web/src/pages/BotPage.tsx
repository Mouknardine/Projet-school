// Dashboard d'un bot : performance, répartition, actions suivies, positions, graphique, trades et journal.

import {
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  ChevronRight,
  CircleX,
  Clock,
  Coins,
  Download,
  Info,
  Pause,
  Play,
  Receipt,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Target,
  Trash2,
  TrendingDown,
  TriangleAlert,
  Wallet,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { BotDetail, LogEntry, LogLevel, Trade, WatchItem } from '../../../shared/types.ts';
import { useAppData } from '../App.tsx';
import { AllocationBar, COLORS, PerformanceChart, PriceChart, RiskTrack, SERIES, Sparkline } from '../components/charts.tsx';
import { TradesTable } from '../components/TradesTable.tsx';
import { Badge, Button, Card, cx, Delta, EmptyState, ErrorBox, LiveDot, Segmented, Spinner, StatTile } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDateTime, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, fmtRelative, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { useNow, usePolling } from '../lib/usePolling.ts';

const INTERVAL_LABEL: Record<string, string> = { '5m': '5 min', '15m': '15 min', '1h': '1 heure', '1d': '1 jour' };

export function BotPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { config } = useAppData();
  const now = useNow(5000);

  const detail = usePolling(() => api.bot(id), [id], 10_000);
  const equity = usePolling(() => api.equity(id), [id], 30_000);
  const trades = usePolling(() => api.trades(id), [id], 15_000);
  const logs = usePolling(() => api.logs(id), [id], 10_000);
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

  if (detail.error && !detail.data) return <ErrorBox>{detail.error}</ErrorBox>;
  if (!detail.data) return <Spinner />;

  const { bot, summary, positions, strategy, watchlist } = detail.data;
  const cur = bot.currency;
  const colorOf = (s: string) => SERIES[Math.max(0, bot.symbols.indexOf(s)) % SERIES.length];
  const vsBench = summary.benchmarkPnlPct !== null ? summary.pnlPct - summary.benchmarkPnlPct : null;
  const anyOpen = watchlist.some((w) => w.marketOpen);
  const selected = symbol && bot.symbols.includes(symbol) ? symbol : bot.symbols[0];

  const status =
    bot.status === 'paused'
      ? { tone: 'warn' as const, label: 'En pause' }
      : anyOpen
        ? { tone: 'up' as const, label: 'En direct · marché ouvert' }
        : { tone: 'neutral' as const, label: 'Actif · marché fermé' };

  return (
    <div className="animate-fade-up space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <nav className="flex items-center gap-1 text-xs text-ink-3">
            <Link to="/" className="hover:text-ink-2">
              Mes bots
            </Link>
            <ChevronRight className="size-3" aria-hidden />
            <span className="truncate text-ink-2">{bot.name}</span>
          </nav>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{bot.name}</h1>
            <Badge tone={status.tone} className="px-2 py-1">
              <LiveDot on={bot.status === 'running' && anyOpen} />
              {status.label}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
            <span className="text-ink-2">{strategy.name}</span>
            <span>·</span>
            <span>Bougies de {INTERVAL_LABEL[bot.interval]}</span>
            <span>·</span>
            <span>Lancé le {fmtDateTime(bot.createdAt)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden /> Analysé {fmtRelative(bot.lastTickAt, now)} (toutes les {config.tickSeconds} s)
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!!busy} onClick={() => run('tick', () => api.tick(bot.id))}>
            <RefreshCw className={cx(busy === 'tick' && 'animate-spin')} aria-hidden /> Analyser
          </Button>
          <Button disabled={!!busy} onClick={() => run('status', () => api.updateBot(bot.id, { status: bot.status === 'running' ? 'paused' : 'running' }))}>
            {bot.status === 'running' ? <Pause aria-hidden /> : <Play aria-hidden />}
            {bot.status === 'running' ? 'Pause' : 'Reprendre'}
          </Button>
          <Button
            variant="ghost"
            disabled={!!busy}
            onClick={() => {
              if (confirm(`Réinitialiser « ${bot.name} » ? Positions et historique seront effacés, le capital revient à ${fmtMoney(bot.initialCapital, cur)}.`))
                run('reset', () => api.reset(bot.id));
            }}
          >
            <RotateCcw aria-hidden /> Réinitialiser
          </Button>
          <Button
            variant="danger"
            disabled={!!busy}
            aria-label="Supprimer le bot"
            onClick={async () => {
              if (!confirm(`Supprimer définitivement « ${bot.name} » et tout son historique ?`)) return;
              setBusy('delete');
              try {
                await api.deleteBot(bot.id);
                navigate('/');
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
                setBusy(null);
              }
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      {actionError && <ErrorBox>{actionError}</ErrorBox>}
      {bot.lastError && <ErrorBox>Problème lors de la dernière analyse : {bot.lastError}</ErrorBox>}

      {/* Performance + répartition */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" bodyClassName="pt-5">
          <PerformanceChart points={equity.data ?? []} initialCapital={bot.initialCapital} currency={cur} height={320} />
        </Card>
        <Card title="Répartition du portefeuille" subtitle={`${fmtNum((summary.positionsValue / summary.equity) * 100, 0)} % investi`}>
          <AllocationBar
            currency={cur}
            items={[
              ...positions.map((p) => ({ key: p.symbol, label: p.symbol, value: p.marketValue, color: colorOf(p.symbol) })),
              { key: 'cash', label: 'Liquidités', value: summary.cash, color: COLORS.cash },
            ]}
          />
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <div>
              <dt className="text-xs text-ink-3">Capital de départ</dt>
              <dd className="num mt-0.5 text-ink">{fmtMoney(bot.initialCapital, cur)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Taille d'une position</dt>
              <dd className="num mt-0.5 text-ink">{bot.positionSizePct} %</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Stop-loss / objectif</dt>
              <dd className="num mt-0.5 text-ink">
                {bot.stopLossPct ? `−${bot.stopLossPct} %` : 'aucun'} / {bot.takeProfitPct ? `+${bot.takeProfitPct} %` : 'aucun'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Frais par ordre</dt>
              <dd className="num mt-0.5 text-ink">{bot.feePct} %</dd>
            </div>
          </dl>
          <RecentOrders trades={trades.data} currency={cur} now={now} />
        </Card>
      </div>

      {/* Chiffres clés */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="vs Buy & Hold"
          icon={<Target aria-hidden />}
          value={vsBench === null ? '–' : `${vsBench > 0 ? '+' : ''}${fmtNum(vsBench)} pts`}
          valueClassName={pnlClass(vsBench)}
          sub={`Buy & Hold : ${fmtPct(summary.benchmarkPnlPct)}`}
        />
        <StatTile
          label="Résultat réalisé"
          icon={<Coins aria-hidden />}
          value={fmtSignedMoney(summary.realizedPnl, cur)}
          valueClassName={pnlClass(summary.realizedPnl)}
          sub="gains et pertes des ventes"
        />
        <StatTile
          label="Résultat latent"
          icon={<Wallet aria-hidden />}
          value={fmtSignedMoney(summary.unrealizedPnl, cur)}
          valueClassName={pnlClass(summary.unrealizedPnl)}
          sub="sur les positions ouvertes"
        />
        <StatTile
          label="Trades"
          icon={<ArrowRightLeft aria-hidden />}
          value={summary.tradesCount}
          sub={summary.closedTrades ? `${summary.closedTrades} ventes · ${fmtNum(summary.winRate ?? 0, 0)} % gagnantes` : 'aucune vente encore'}
        />
        <StatTile
          label="Drawdown max"
          icon={<TrendingDown aria-hidden />}
          value={summary.maxDrawdownPct > 0 ? `−${fmtNum(summary.maxDrawdownPct)} %` : '0 %'}
          valueClassName={summary.maxDrawdownPct > 0 ? 'text-down' : undefined}
          sub="pire baisse depuis un sommet"
        />
        <StatTile label="Frais payés" icon={<Receipt aria-hidden />} value={fmtMoney(summary.feesPaid, cur)} sub={`${bot.feePct} % par ordre`} />
      </div>

      {/* Actions suivies */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">Actions suivies</h2>
          <span className="text-xs text-ink-3">Cliquez pour afficher le graphique</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {watchlist.map((w) => (
            <WatchCard
              key={w.symbol}
              item={w}
              color={colorOf(w.symbol)}
              held={positions.some((p) => p.symbol === w.symbol)}
              active={w.symbol === selected}
              onSelect={() => {
                setSymbol(w.symbol);
                document.getElementById('graphique')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          ))}
        </div>
      </section>

      {/* Positions ouvertes */}
      <Card title="Positions ouvertes" subtitle={`${positions.length} position(s) · ${fmtMoney(summary.positionsValue, cur)}`} bodyClassName={positions.length ? 'px-0 pb-2' : undefined}>
        {positions.length === 0 ? (
          <EmptyState icon={<Wallet />} title="Aucune position ouverte">
            Tout le capital est en liquidités. Le bot achètera dès que sa stratégie donnera un signal d'achat.
          </EmptyState>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs text-ink-3">
                  <th className="px-5 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 text-right font-medium">Quantité</th>
                  <th className="px-3 py-2.5 text-right font-medium">Prix d'achat</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cours</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valeur</th>
                  <th className="px-3 py-2.5 text-right font-medium">Résultat latent</th>
                  <th className="px-3 py-2.5 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <ShieldAlert className="size-3.5" aria-hidden /> Stop → objectif
                    </span>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Ouverte</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="num">
                {positions.map((p) => (
                  <tr key={p.symbol} className="border-b border-line/70 transition-colors last:border-0 hover:bg-raised/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="h-7 w-1 rounded-full" style={{ background: colorOf(p.symbol) }} />
                        <div>
                          <div className="font-semibold text-ink">{p.symbol}</div>
                          <div className="max-w-[160px] truncate text-xs text-ink-3">{watchlist.find((w) => w.symbol === p.symbol)?.name ?? ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-ink-2">{fmtQty(p.qty)}</td>
                    <td className="px-3 py-3 text-right text-ink-2">{fmtPrice(p.entryPrice)}</td>
                    <td className="px-3 py-3 text-right text-ink">{fmtPrice(p.lastPrice)}</td>
                    <td className="px-3 py-3 text-right text-ink">{fmtMoney(p.marketValue, cur)}</td>
                    <td className="px-3 py-3 text-right">
                      <div className={pnlClass(p.unrealizedPnl)}>{fmtSignedMoney(p.unrealizedPnl, cur)}</div>
                      <Delta value={p.unrealizedPnlPct} className="mt-0.5" />
                    </td>
                    <td className="px-3 py-3">
                      <RiskTrack stop={p.stopLossPrice} target={p.takeProfitPrice} entry={p.entryPrice} price={p.lastPrice ?? p.entryPrice} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-3">{fmtRelative(p.openedAt, now)}</td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        className="h-8 px-2.5 text-xs"
                        disabled={!!busy}
                        onClick={() => {
                          if (confirm(`Vendre toute la position ${p.symbol} au cours actuel ?`)) run('close', () => api.closePosition(bot.id, p.symbol));
                        }}
                      >
                        Vendre
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Graphique des cours */}
      <SymbolChart botId={bot.id} symbols={bot.symbols} symbol={selected} onSymbol={setSymbol} tradesVersion={summary.tradesCount} />

      {/* Historique + journal */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-3">
        <Card
          id="historique"
          title="Historique des trades"
          subtitle={`${summary.tradesCount} ordre(s), chacun avec la raison de la décision`}
          className="2xl:col-span-2"
          actions={
            <a
              href={api.csvUrl(bot.id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-raised hover:text-ink"
            >
              <Download className="size-3.5" aria-hidden /> Export CSV
            </a>
          }
        >
          {trades.data ? <TradesTable trades={trades.data} currency={cur} colorOf={colorOf} /> : <Spinner />}
        </Card>
        <Journal logs={logs.data} />
      </div>
    </div>
  );
}

function RecentOrders({ trades, currency, now }: { trades: Trade[] | null; currency: string; now: number }) {
  if (!trades || trades.length === 0) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-ink-2">Derniers ordres</h3>
        <a href="#historique" className="text-xs text-accent-text hover:underline">
          Tout voir
        </a>
      </div>
      <ul className="space-y-1">
        {trades.slice(0, 5).map((t) => {
          const buy = t.side === 'BUY';
          return (
            <li key={t.id} className="flex items-center gap-2.5 rounded-lg py-1.5">
              <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', buy ? 'bg-up/12 text-up' : 'bg-down/12 text-down')} aria-hidden>
                {buy ? <ArrowUpRight /> : <ArrowDownRight />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">
                  {buy ? 'Achat' : 'Vente'} {t.symbol}
                </div>
                <div className="text-xs text-ink-3">{fmtRelative(t.time, now)}</div>
              </div>
              <div className="num text-right text-sm">
                <div className="text-ink-2">{fmtMoney(t.amount, currency)}</div>
                {t.pnl !== null && <div className={cx('text-xs', pnlClass(t.pnl))}>{fmtSignedMoney(t.pnl, currency)}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WatchCard({ item, color, held, active, onSelect }: { item: WatchItem; color: string; held: boolean; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        'group rounded-2xl border bg-surface p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        active ? 'border-accent/60' : 'border-line hover:border-line-strong',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: color }} />
            <span className="font-semibold text-ink">{item.symbol}</span>
            {held && <Badge tone="accent">en portefeuille</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-3">{item.name ?? '—'}</div>
        </div>
        <Delta value={item.dayChangePct} />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-lg font-semibold tracking-tight text-ink">{fmtPrice(item.price)}</div>
        <Sparkline values={item.spark} base={item.spark[0]} className="h-9 w-28" />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <LiveDot on={item.marketOpen} /> {item.marketOpen ? 'Marché ouvert' : 'Marché fermé'}
        </span>
        <span>
          depuis le lancement <span className={pnlClass(item.sinceStartPct)}>{fmtPct(item.sinceStartPct)}</span>
        </span>
      </div>
    </button>
  );
}

function SymbolChart({ botId, symbols, symbol, onSymbol, tradesVersion }: {
  botId: number;
  symbols: string[];
  symbol: string;
  onSymbol: (s: string) => void;
  tradesVersion: number;
}) {
  const chart = usePolling(() => api.chart(botId, symbol), [botId, symbol, tradesVersion], 30_000);
  const q = chart.data?.quote;
  const change = q && q.previousClose ? (q.price / q.previousClose - 1) * 100 : null;

  return (
    <section id="graphique" className="scroll-mt-20 min-w-0 rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-4 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Cours, indicateurs et décisions du bot</h2>
          {q ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-2xl font-semibold tracking-tight text-ink">
                {fmtPrice(q.price)} <span className="text-sm font-normal text-ink-3">{q.currency}</span>
              </span>
              <Delta value={change} />
              <span className="text-xs text-ink-3">aujourd'hui</span>
              <span className="text-xs text-ink-3">·</span>
              <span className="truncate text-xs text-ink-3">
                {q.name} · {q.exchange}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
                <LiveDot on={q.marketOpen} /> {q.marketOpen ? 'ouvert' : 'fermé'}
              </span>
            </div>
          ) : (
            <div className="mt-2 h-8" />
          )}
        </div>
        <Segmented value={symbol} onChange={onSymbol} items={symbols.map((s) => ({ id: s, label: s }))} />
      </header>
      <div className="px-3 pb-4 sm:px-5">
        {chart.error && !chart.data && <ErrorBox>{chart.error}</ErrorBox>}
        {!chart.data && !chart.error && <Spinner />}
        {chart.data && (
          <PriceChart
            bars={chart.data.bars}
            overlays={chart.data.overlays}
            series={chart.data.series}
            trades={chart.data.trades}
            interval={chart.data.interval}
            height={chart.data.overlays.some((o) => o.pane === 'oscillator') ? 460 : 400}
            initialBars={150}
          />
        )}
      </div>
    </section>
  );
}

const LEVELS: Record<LogLevel, { label: string; icon: typeof Info; className: string }> = {
  trade: { label: 'Trade', icon: ArrowRightLeft, className: 'bg-accent/15 text-accent-text' },
  signal: { label: 'Signal', icon: Zap, className: 'bg-s7/15 text-[#b3abf2]' },
  info: { label: 'Analyse', icon: Info, className: 'bg-raised text-ink-3' },
  warn: { label: 'Alerte', icon: TriangleAlert, className: 'bg-warn/12 text-warn' },
  error: { label: 'Erreur', icon: CircleX, className: 'bg-down/12 text-down' },
};

type JournalFilter = 'all' | 'trades' | 'signals' | 'alerts';

function Journal({ logs }: { logs: LogEntry[] | null }) {
  const [filter, setFilter] = useState<JournalFilter>('all');
  const visible = (logs ?? []).filter((l) =>
    filter === 'all' ? true : filter === 'trades' ? l.level === 'trade' : filter === 'signals' ? l.level === 'signal' || l.level === 'trade' : l.level === 'warn' || l.level === 'error',
  );
  return (
    <Card
      title="Journal du bot"
      subtitle="Ce que le bot a analysé et décidé"
      bodyClassName="px-0 pb-0"
      actions={
        <Segmented
          value={filter}
          onChange={setFilter}
          items={[
            { id: 'all', label: 'Tout' },
            { id: 'trades', label: 'Trades' },
            { id: 'signals', label: 'Signaux' },
            { id: 'alerts', label: 'Alertes' },
          ]}
        />
      }
    >
      {!logs ? (
        <div className="px-5">
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<Info />} title="Rien à afficher" />
      ) : (
        <ol className="max-h-[620px] overflow-y-auto px-5 pb-4">
          {visible.map((l, i) => {
            const meta = LEVELS[l.level];
            const Icon = meta.icon;
            return (
              <li key={l.id} className="relative flex gap-3 pb-4">
                {i < visible.length - 1 && <span className="absolute left-[13px] top-8 bottom-0 w-px bg-line" aria-hidden />}
                <span className={cx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5', meta.className)}>
                  <Icon aria-hidden />
                </span>
                <div className="min-w-0 pt-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                    <span className="font-medium text-ink-2">{meta.label}</span>
                    {l.symbol && <span className="font-semibold text-ink">{l.symbol}</span>}
                    <span className="num">{fmtDateTime(l.time)}</span>
                  </div>
                  <p className={cx('mt-0.5 text-sm leading-snug', l.level === 'trade' ? 'text-ink' : 'text-ink-2')}>{l.message}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
