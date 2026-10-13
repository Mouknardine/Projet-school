// Éléments communs aux pages d'un bot : gestion, statistiques, règle de la stratégie, journal.

import {
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  CircleX,
  Coins,
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
import type { Bot, BotDetail, BotSummary, BrokerInfo, LogEntry, LogLevel, StrategyInfo } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { fmtDateTime, fmtMoney, fmtNum, fmtPct, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { Button, Card, cx, EmptyState, Segmented, Spinner, StatTile } from './ui.tsx';

const INTERVAL_LABEL: Record<string, string> = { '5m': '5 minutes', '15m': '15 minutes', '1h': '1 heure', '1d': '1 jour' };

// ---------------------------------------------------------------------------
// Gérer le bot
// ---------------------------------------------------------------------------

export function ManageCard({ bot, busy, onRun, onDelete }: {
  bot: Bot;
  busy: string | null;
  onRun: (label: string, fn: () => Promise<BotDetail | void>) => void;
  onDelete: () => void;
}) {
  const cur = bot.currency;
  return (
    <Card id="gerer" title="Gérer ce placement" subtitle="Ces actions demandent le mot de passe administrateur.">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ManageAction
          button={
            <Button className="w-full sm:w-auto" disabled={!!busy} onClick={() => onRun('tick', () => api.tick(bot.id))}>
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
              onClick={() => onRun('status', () => api.updateBot(bot.id, { status: bot.status === 'running' ? 'paused' : 'running' }))}
            >
              {bot.status === 'running' ? <Pause aria-hidden /> : <Play aria-hidden />}
              {bot.status === 'running' ? 'Mettre en pause' : 'Relancer le bot'}
            </Button>
          }
        >
          {bot.status === 'running'
            ? "En pause, le bot continue de suivre les cours mais n'achète et ne vend plus."
            : 'Le bot recommence à acheter et vendre selon ses règles.'}
        </ManageAction>
        <ManageAction
          button={
            <Button
              className="w-full sm:w-auto"
              disabled={!!busy}
              onClick={() => {
                if (confirm(`Recommencer « ${bot.name} » à zéro ? Ses actions et son historique seront effacés, et il repartira avec ${fmtMoney(bot.initialCapital, cur)}.`))
                  onRun('reset', () => api.reset(bot.id));
              }}
            >
              <RotateCcw aria-hidden /> Recommencer à zéro
            </Button>
          }
        >
          Efface les achats, les ventes et l'historique, puis repart avec le capital de départ ({fmtMoney(bot.initialCapital, cur)}).
        </ManageAction>
        <ManageAction
          button={
            <Button
              variant="danger"
              className="w-full sm:w-auto"
              disabled={!!busy}
              onClick={() => {
                if (confirm(`Supprimer définitivement « ${bot.name} » et tout son historique ?`)) onDelete();
              }}
            >
              <Trash2 aria-hidden /> Supprimer
            </Button>
          }
        >
          Supprime le placement et tout son historique. C'est définitif.
        </ManageAction>
      </ul>
    </Card>
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


/** Barre « marge avant la limite de perte » : de la limite (à gauche) à la valeur de départ (à droite). */
export function LossBar({ floor, base, value }: { floor: number; base: number; value: number }) {
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

export function StrategyCard({ bot, strategy, tickSeconds, broker }: { bot: Bot; strategy: StrategyInfo; tickSeconds: number; broker?: BrokerInfo }) {
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
// Statistiques, chacune avec son explication
// ---------------------------------------------------------------------------

export function Stats({ bot, summary, brokerName }: { bot: Bot; summary: BotSummary; brokerName?: string }) {
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

export function Journal({ logs }: { logs: LogEntry[] | null }) {
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
