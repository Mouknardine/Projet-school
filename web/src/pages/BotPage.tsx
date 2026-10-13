// Dashboard d'un bot, pensé pour être compris sans connaître la bourse :
// un résumé en phrases, la stratégie expliquée, ce que le bot possède, ses trades avec leurs raisons,
// le graphique des cours, les statistiques (avec une explication pour chacune) et le journal.

import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpRight,
  ChevronDown,
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
  ShieldCheck,
  Target,
  Trash2,
  TrendingDown,
  TriangleAlert,
  Trophy,
  Wallet,
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Bot, BotDetail, BotSummary, BrokerInfo, LogEntry, LogLevel, Position, StrategyInfo, WatchItem } from '../../../shared/types.ts';
import { useAppData } from '../App.tsx';
import { AllocationBar, COLORS, PerformanceChart, PriceChart, RiskTrack, SERIES, Sparkline } from '../components/charts.tsx';
import { LEVEL_COLORS, ProfileBadge, RiskGauge } from '../components/profile.tsx';
import { TradesTable } from '../components/TradesTable.tsx';
import { assetInfo, PROFILES, QUESTIONS, trendExplanation } from '../../../shared/profile.ts';
import { Badge, Button, Card, cx, Delta, EmptyState, ErrorBox, LiveDot, Segmented, Spinner, StatTile } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, fmtRelative, fmtSession, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { useNow, usePolling } from '../lib/usePolling.ts';

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

const INTERVAL_LABEL: Record<string, string> = { '5m': '5 minutes', '15m': '15 minutes', '1h': '1 heure', '1d': '1 jour' };

/** Les parties de la page, pour s'y rendre directement depuis le sommaire. */
const SECTIONS = [
  { id: 'resume', label: 'Résumé' },
  { id: 'profil', label: 'Profil et protections' },
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

  if (detail.error && !detail.data) return <ErrorBox>{detail.error}</ErrorBox>;
  if (!detail.data) return <Spinner />;

  const { bot, summary, positions, strategy, watchlist, lossFloor, protection } = detail.data;
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
          {bot.profile && <ProfileBadge level={bot.profile.level} className="py-1" />}
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

      {/* Profil et protections (ou la stratégie, pour un bot réglé à la main) */}
      {bot.profile ? (
        <ProfileCard bot={bot} strategy={strategy} equity={summary.equity} lossFloor={lossFloor} brokerName={broker?.name} />
      ) : (
        <div id="profil" className="scroll-mt-20">
          <StrategyCard bot={bot} strategy={strategy} tickSeconds={config.tickSeconds} broker={broker} />
        </div>
      )}

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
          simple={!!bot.profile}
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
          {bot.profile && <StrategyCard bot={bot} strategy={strategy} tickSeconds={config.tickSeconds} broker={broker} />}
          <Stats bot={bot} summary={summary} brokerName={broker?.name} />
          <Journal logs={logs.data} />
        </div>
      </details>

      {/* Gestion */}
      <Card id="gerer" title="Gérer ce placement" subtitle="Ces actions demandent le mot de passe administrateur.">
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ManageAction
            button={
              <Button className="w-full sm:w-auto" disabled={!!busy} onClick={() => run('tick', () => api.tick(bot.id))}>
                <RefreshCw className={cx(busy === 'tick' && 'animate-spin')} aria-hidden /> Analyser maintenant
              </Button>
            }
          >
            Le bot vérifie les cours tout de suite, sans attendre la prochaine analyse automatique.
          </ManageAction>
          <ManageAction
            button={
              <Button
                className="w-full sm:w-auto"
                disabled={!!busy}
                onClick={() => run('status', () => api.updateBot(bot.id, { status: bot.status === 'running' ? 'paused' : 'running' }))}
              >
                {bot.status === 'running' ? <Pause aria-hidden /> : <Play aria-hidden />}
                {bot.status === 'running' ? 'Mettre en pause' : 'Relancer le bot'}
              </Button>
            }
          >
            {bot.status === 'running'
              ? "En pause, le bot continue de suivre les cours mais n'achète et ne vend plus."
              : 'Le bot recommence à acheter et vendre selon sa stratégie.'}
          </ManageAction>
          <ManageAction
            button={
              <Button
                className="w-full sm:w-auto"
                disabled={!!busy}
                onClick={() => {
                  if (confirm(`Recommencer « ${bot.name} » à zéro ? Ses actions et son historique seront effacés, et il repartira avec ${fmtMoney(bot.initialCapital, cur)}.`))
                    run('reset', () => api.reset(bot.id));
                }}
              >
                <RotateCcw aria-hidden /> Recommencer à zéro
              </Button>
            }
          >
            Efface les trades et l'historique, puis repart avec le capital de départ ({fmtMoney(bot.initialCapital, cur)}).
          </ManageAction>
          <ManageAction
            button={
              <Button
                variant="danger"
                className="w-full sm:w-auto"
                disabled={!!busy}
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
                <Trash2 aria-hidden /> Supprimer le bot
              </Button>
            }
          >
            Supprime le bot et tout son historique. C'est définitif.
          </ManageAction>
        </ul>
      </Card>
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
// Profil et protections (placement créé avec le questionnaire)
// ---------------------------------------------------------------------------

function ProfileCard({ bot, strategy, equity, lossFloor, brokerName }: { bot: Bot; strategy: StrategyInfo; equity: number; lossFloor: number | null; brokerName?: string }) {
  const level = bot.profile!.level;
  const profile = PROFILES[level];
  const cur = bot.currency;
  const invested = Math.min(100, bot.positionSizePct * bot.symbols.length);
  const answers = bot.profile!.answers;
  return (
    <Card id="profil" title="Votre profil et vos protections" subtitle="Le bot a été réglé à partir de vos réponses au questionnaire.">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="text-2xl font-semibold tracking-tight" style={{ color: LEVEL_COLORS[level] }}>
            {profile.name}
          </div>
          <p className="mt-0.5 text-sm text-ink-2">{profile.tagline}</p>
          <RiskGauge level={level} showLabels className="mt-3 max-w-xs" />
          <p className="mt-4 text-sm leading-relaxed text-ink-2">
            <b className="font-semibold text-ink">Comment il décide : </b>
            {bot.strategy === 'trend'
              ? trendExplanation(bot.params.period, bot.params.band)
              : `Il achète quand ${lowerFirst(strategy.rules.buy)} Il vend quand ${lowerFirst(strategy.rules.sell)}`}
          </p>
        </div>
        <ul className="space-y-3 text-sm leading-relaxed text-ink-2">
          {lossFloor !== null && (
            <li className="rounded-xl bg-page/60 p-3.5">
              <div className="flex items-center gap-1.5 font-semibold text-ink [&_svg]:size-4">
                <ShieldCheck className="text-accent-text" aria-hidden /> Limite de perte : {fmtMoney(lossFloor, cur, 0)}
              </div>
              <p className="mt-1">
                Si votre placement descend sous ce montant (−{bot.maxLossPct}&nbsp;%), le bot vend tout et se met en pause. Aujourd'hui, il vaut{' '}
                {fmtMoney(equity, cur, 0)} :{' '}
                {equity > lossFloor ? (
                  <>
                    encore <b className="font-semibold text-ink">{fmtMoney(equity - lossFloor, cur, 0)}</b> de marge.
                  </>
                ) : (
                  <b className="font-semibold text-warn">la limite est atteinte.</b>
                )}
              </p>
              <LossBar floor={lossFloor} base={lossFloor / (1 - bot.maxLossPct / 100)} value={equity} />
            </li>
          )}
          {bot.stopLossPct > 0 && (
            <li>
              <b className="font-semibold text-ink">Pour chaque action : </b>
              il la revend si elle baisse de {bot.stopLossPct}&nbsp;% après l'achat
              {bot.takeProfitPct > 0 ? `, et encaisse le gain si elle monte de ${bot.takeProfitPct} %` : ''}.
            </li>
          )}
          {invested < 100 && (
            <li>
              <b className="font-semibold text-ink">Une réserve : </b>
              il garde toujours au moins {100 - invested}&nbsp;% de votre argent de côté, sans l'investir.
            </li>
          )}
          <li>
            <b className="font-semibold text-ink">Les frais : </b>
            ceux de {brokerName ?? 'votre banque'} (courtage, change, droit de timbre), payés à chaque achat et chaque vente.
          </li>
        </ul>
      </div>
      <details className="group mt-4 rounded-xl border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
          Revoir mes réponses au questionnaire
          <ChevronDown className="size-4 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <dl className="grid gap-x-6 gap-y-2.5 border-t border-line px-3.5 py-3 text-sm sm:grid-cols-2">
          {QUESTIONS.filter((q) => answers[q.id]).map((q) => (
            <div key={q.id}>
              <dt className="text-xs text-ink-3">{q.title}</dt>
              <dd className="text-ink">{q.options.find((o) => o.id === answers[q.id])?.label ?? answers[q.id]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Card>
  );
}

/** Barre « marge avant la limite de perte » : de la limite (à gauche) à la valeur de départ (à droite). */
function LossBar({ floor, base, value }: { floor: number; base: number; value: number }) {
  const top = Math.max(base, value);
  const pos = Math.min(1, Math.max(0, (value - floor) / (top - floor || 1)));
  return (
    <div className="mt-3" aria-hidden>
      <div className="relative h-2 rounded-full" style={{ background: 'linear-gradient(90deg, #f6465db3, #fab21999, #2ebd85b3)' }}>
        <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink" style={{ left: `${pos * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3">
        <span>limite</span>
        <span>départ</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stratégie expliquée
// ---------------------------------------------------------------------------

function StrategyCard({ bot, strategy, tickSeconds, broker }: { bot: Bot; strategy: StrategyInfo; tickSeconds: number; broker?: BrokerInfo }) {
  return (
    <Card id="strategie" title="Comment ce bot décide" subtitle={`Stratégie : ${strategy.name}`}>
      <p className="max-w-4xl text-sm leading-relaxed text-ink-2">{strategy.description}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-up/25 bg-up/[0.06] p-3.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-up [&_svg]:size-4">
            <ArrowUpRight aria-hidden /> Il achète quand…
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{strategy.rules.buy}</p>
        </div>
        <div className="rounded-xl border border-down/25 bg-down/[0.06] p-3.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-down [&_svg]:size-4">
            <ArrowDownRight aria-hidden /> Il vend quand…
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{strategy.rules.sell}</p>
        </div>
      </div>
      <div className="mt-4 rounded-xl bg-page/60 p-3.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink [&_svg]:size-4">
          <ShieldCheck aria-hidden className="text-accent-text" /> Ses règles de prudence
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-2">
          <li>À chaque achat, il investit au plus {bot.positionSizePct} % de son argent, pour ne pas tout miser sur une seule action.</li>
          <li>
            {bot.stopLossPct
              ? `Il revend automatiquement une action qui perd ${bot.stopLossPct} % (« stop-loss »), pour limiter les pertes.`
              : "Pas de vente automatique en cas de perte (stop-loss désactivé)."}
          </li>
          <li>
            {bot.takeProfitPct
              ? `Il revend automatiquement une action qui gagne ${bot.takeProfitPct} % (« objectif » ou take-profit), pour encaisser le gain.`
              : "Pas de vente automatique en cas de gain (objectif désactivé)."}
          </li>
          {bot.broker === 'simple' || !broker ? (
            <li>Chaque achat ou vente coûte {bot.feePct} % de frais (frais simplifiés).</li>
          ) : (
            <li>
              Son compte est en {bot.currency}, avec les vrais tarifs de {broker.name} : courtage, frais de change pour les actions cotées dans une autre
              monnaie{broker.swiss ? ', droit de timbre suisse' : ''} et taxes étrangères (France, Royaume-Uni, États-Unis). Le détail est affiché sur chaque
              trade.
            </li>
          )}
          <li>
            Il vérifie les cours toutes les {tickSeconds} secondes et prend ses décisions avec des prix résumés par tranches de {INTERVAL_LABEL[bot.interval]} («
            bougies »).
          </li>
        </ul>
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

function ManageAction({ button, children }: { button: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-page/60 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="text-sm leading-relaxed text-ink-2 sm:order-2 sm:flex-1">{children}</p>
      <div className="shrink-0 sm:order-1 sm:w-52">{button}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Statistiques, chacune avec son explication
// ---------------------------------------------------------------------------

function Stats({ bot, summary, brokerName }: { bot: Bot; summary: BotSummary; brokerName?: string }) {
  const cur = bot.currency;
  const vs = summary.benchmarkPnlPct !== null ? summary.pnlPct - summary.benchmarkPnlPct : null;
  const wins = summary.winRate !== null ? Math.round((summary.winRate / 100) * summary.closedTrades) : 0;
  return (
    <section id="statistiques" className="scroll-mt-20">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-ink">Statistiques</h2>
        <p className="mt-0.5 text-xs text-ink-3">Touchez le « ? » pour savoir ce que veut dire chaque chiffre.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Comparé à « acheter et garder »"
          icon={<Target aria-hidden />}
          value={vs === null ? '–' : `${vs > 0 ? '+' : ''}${fmtNum(vs)} pts`}
          valueClassName={pnlClass(vs)}
          sub={`acheter et garder : ${fmtPct(summary.benchmarkPnlPct)}`}
          help="Différence entre le gain du bot et celui qu'on aurait eu en achetant simplement les mêmes actions au départ, à parts égales, sans jamais les revendre. Positif : le bot fait mieux. Négatif : il fait moins bien."
        />
        <StatTile
          label="Gains encaissés"
          icon={<Coins aria-hidden />}
          value={fmtSignedMoney(summary.realizedPnl, cur)}
          valueClassName={pnlClass(summary.realizedPnl)}
          sub="sur les actions déjà revendues"
          help="Gains et pertes des actions que le bot a déjà revendues. Ce résultat est définitif."
        />
        <StatTile
          label="Gains en cours"
          icon={<Wallet aria-hidden />}
          value={fmtSignedMoney(summary.unrealizedPnl, cur)}
          valueClassName={pnlClass(summary.unrealizedPnl)}
          sub="sur les actions encore possédées"
          help="Gain ou perte des actions que le bot possède encore, calculé au cours actuel. Ce chiffre bouge avec la bourse tant que le bot ne les a pas revendues."
        />
        <StatTile
          label="Ventes gagnantes"
          icon={<Trophy aria-hidden />}
          value={summary.winRate === null ? '–' : `${fmtNum(summary.winRate, 0)} %`}
          sub={summary.closedTrades ? `${wins} sur ${summary.closedTrades} vente${summary.closedTrades > 1 ? 's' : ''}` : 'aucune vente pour l’instant'}
          help="Part des ventes qui ont rapporté de l'argent. Une stratégie peut gagner de l'argent avec moins de 50 % de ventes gagnantes, si ses gains sont plus gros que ses pertes."
        />
        <StatTile
          label="Pire chute"
          icon={<TrendingDown aria-hidden />}
          value={summary.maxDrawdownPct > 0 ? `−${fmtNum(summary.maxDrawdownPct)} %` : '0 %'}
          valueClassName={summary.maxDrawdownPct > 0 ? 'text-down' : undefined}
          sub="plus forte baisse depuis un sommet"
          help="La plus forte baisse de la valeur du bot entre un sommet et le creux qui a suivi (en finance : le « drawdown maximal »). Elle mesure le risque : ce qu'on aurait perdu en investissant au pire moment."
        />
        <StatTile
          label="Frais payés"
          icon={<Receipt aria-hidden />}
          value={fmtMoney(summary.feesPaid, cur)}
          sub={bot.broker === 'simple' || !brokerName ? `${bot.feePct} % par ordre` : `tarifs ${brokerName}`}
          help="Tout ce que la banque et l'État prélèvent : courtage, frais de change, droit de timbre suisse, taxes étrangères. Un bot qui fait beaucoup de trades paie beaucoup de frais, ce qui réduit ses gains. Touchez un trade pour voir le détail."
        />
      </div>
    </section>
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

function SymbolChart({ botId, symbols, symbol, onSymbol, tradesVersion, interval, simple }: {
  botId: number;
  symbols: string[];
  symbol: string;
  onSymbol: (s: string) => void;
  tradesVersion: number;
  interval: string;
  /** Pour un débutant : les calculs de la stratégie (moyennes, RSI…) sont masqués au départ. */
  simple: boolean;
}) {
  const chart = usePolling(() => api.chart(botId, symbol), [botId, symbol, tradesVersion], 60_000);
  const [showCalc, setShowCalc] = useState(!simple);
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

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

const LEVELS: Record<LogLevel, { label: string; icon: typeof Info; className: string }> = {
  trade: { label: 'Achat / vente', icon: ArrowRightLeft, className: 'bg-accent/15 text-accent-text' },
  signal: { label: 'Signal', icon: Zap, className: 'bg-s7/15 text-[#b3abf2]' },
  info: { label: 'Analyse', icon: Info, className: 'bg-raised text-ink-3' },
  warn: { label: 'Attention', icon: TriangleAlert, className: 'bg-warn/12 text-warn' },
  error: { label: 'Erreur', icon: CircleX, className: 'bg-down/12 text-down' },
};

type JournalFilter = 'important' | 'trades' | 'all';
const JOURNAL_PAGE = 10;

/** Les analyses de routine (« aucun ordre ») sont nombreuses : elles ne s'affichent qu'avec le filtre « Tout ». */
const isRoutine = (l: LogEntry) => l.level === 'info' && l.message.startsWith('Analyse');

function Journal({ logs }: { logs: LogEntry[] | null }) {
  const [filter, setFilter] = useState<JournalFilter>('important');
  const [limit, setLimit] = useState(JOURNAL_PAGE);
  const visible = (logs ?? []).filter((l) => (filter === 'all' ? true : filter === 'trades' ? l.level === 'trade' : !isRoutine(l)));
  return (
    <Card
      id="journal"
      title="Journal : tout ce que le bot a fait"
      subtitle="Du plus récent au plus ancien. « Tout » affiche aussi les analyses qui n'ont mené à aucun achat ni vente."
      bodyClassName="px-0 pb-0"
      actions={
        <Segmented
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setLimit(JOURNAL_PAGE);
          }}
          items={[
            { id: 'important', label: 'Important' },
            { id: 'trades', label: 'Achats / ventes' },
            { id: 'all', label: 'Tout' },
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
        <>
          <ol className="px-5 pb-2">
            {visible.slice(0, limit).map((l, i, arr) => (
              <JournalItem key={l.id} entry={l} last={i === arr.length - 1} />
            ))}
          </ol>
          {visible.length > limit && (
            <div className="px-5 pb-5">
              <button type="button" onClick={() => setLimit(limit + JOURNAL_PAGE)} className="h-9 w-full rounded-lg border border-line text-sm font-medium text-ink-2 hover:bg-raised">
                Afficher plus ({visible.length - limit} restants)
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Une ligne du journal. Les messages longs sont repliés sur 3 lignes, avec un bouton pour tout lire. */
function JournalItem({ entry: l, last }: { entry: LogEntry; last: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = LEVELS[l.level];
  const Icon = meta.icon;
  const long = l.message.length > 150;
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span className="absolute left-[13px] top-8 bottom-0 w-px bg-line" aria-hidden />}
      <span className={cx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5', meta.className)}>
        <Icon aria-hidden />
      </span>
      <div className="min-w-0 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
          <span className="font-medium text-ink-2">{meta.label}</span>
          {l.symbol && <span className="font-semibold text-ink">{l.symbol}</span>}
          <span className="num">{fmtDateTime(l.time)}</span>
        </div>
        <p className={cx('mt-0.5 text-sm leading-relaxed', l.level === 'trade' ? 'text-ink' : 'text-ink-2', long && !open && 'line-clamp-3')}>{l.message}</p>
        {long && (
          <button type="button" onClick={() => setOpen(!open)} className="mt-0.5 text-xs font-medium text-accent-text hover:underline">
            {open ? 'Réduire' : 'Lire la suite'}
          </button>
        )}
      </div>
    </li>
  );
}
