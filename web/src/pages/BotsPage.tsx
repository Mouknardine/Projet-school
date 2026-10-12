// Page d'accueil : liste des bots et leurs performances.

import { Bot as BotIcon, FlaskConical, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useAppData } from '../App.tsx';
import { SERIES, Sparkline } from '../components/charts.tsx';
import { Badge, Delta, EmptyState, ErrorBox, LiveDot, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDate, fmtMoney, fmtNum, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { usePolling } from '../lib/usePolling.ts';

export function BotsPage() {
  const { strategies } = useAppData();
  const { data, error, loading } = usePolling(() => api.bots(), [], 15_000);
  const strategyName = (id: string) => strategies.find((s) => s.id === id)?.name ?? id;
  const running = data?.filter((b) => b.bot.status === 'running').length ?? 0;
  const totalTrades = data?.reduce((a, b) => a + b.summary.tradesCount, 0) ?? 0;
  const best = data && data.length ? [...data].sort((a, b) => b.summary.pnlPct - a.summary.pnlPct)[0] : null;

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Mes bots de trading</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-ink-3">
            Chaque bot reçoit un capital fictif et achète ou vend des actions selon sa stratégie, en suivant les cours réels du marché.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/backtest"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-line [&_svg]:size-4"
          >
            <FlaskConical aria-hidden /> Backtest
          </Link>
          <Link
            to="/bots/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-white hover:bg-[#4a94ea] [&_svg]:size-4"
          >
            <Plus aria-hidden /> Nouveau bot
          </Link>
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {loading && !data && <Spinner />}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-line bg-surface px-5 py-4">
            <div className="text-xs font-medium text-ink-3">Bots actifs</div>
            <div className="mt-1 text-2xl font-semibold text-ink">
              {running} <span className="text-base font-normal text-ink-3">/ {data.length}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface px-5 py-4">
            <div className="text-xs font-medium text-ink-3">Ordres passés au total</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{totalTrades}</div>
          </div>
          <div className="rounded-2xl border border-line bg-surface px-5 py-4">
            <div className="text-xs font-medium text-ink-3">Meilleur bot</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate text-2xl font-semibold text-ink">{best?.bot.name}</span>
              <Delta value={best?.summary.pnlPct} />
            </div>
          </div>
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<BotIcon />} title="Aucun bot pour l'instant">
            Créez votre premier bot : choisissez un capital, des actions et une stratégie. Il commencera à trader dès l'ouverture de la bourse.
          </EmptyState>
          <div className="flex justify-center gap-3 pb-10">
            <Link to="/bots/new" className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-[#4a94ea]">
              Créer un bot
            </Link>
            <Link to="/backtest" className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm text-ink-2 hover:bg-raised">
              Tester une stratégie sur le passé
            </Link>
          </div>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.map(({ bot, summary }) => {
            const vsBench = summary.benchmarkPnlPct !== null ? summary.pnlPct - summary.benchmarkPnlPct : null;
            return (
              <Link
                key={bot.id}
                to={`/bots/${bot.id}`}
                className="group rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{bot.name}</div>
                    <div className="mt-0.5 truncate text-xs text-ink-3">
                      {strategyName(bot.strategy)} · {bot.interval}
                    </div>
                  </div>
                  <Badge tone={bot.status === 'running' ? 'up' : 'warn'}>
                    <LiveDot on={bot.status === 'running'} />
                    {bot.status === 'running' ? 'Actif' : 'En pause'}
                  </Badge>
                </div>

                <div className="mt-5 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-ink-3">Valeur du portefeuille</div>
                    <div className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-ink">{fmtMoney(summary.equity, bot.currency)}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Delta value={summary.pnlPct} />
                      <span className={`text-xs ${pnlClass(summary.pnl)}`}>{fmtSignedMoney(summary.pnl, bot.currency)}</span>
                    </div>
                  </div>
                  <Sparkline values={summary.sparkline} base={bot.initialCapital} color={SERIES[0]} className="h-12 w-32 shrink-0" />
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {bot.symbols.map((s, i) => (
                    <span key={s} className="inline-flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
                      <span className="size-1.5 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
                      {s}
                    </span>
                  ))}
                </div>

                <div className="num mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                  <div>
                    <div className="text-ink-3">Trades</div>
                    <div className="mt-0.5 text-ink">{summary.tradesCount}</div>
                  </div>
                  <div>
                    <div className="text-ink-3">vs Buy & Hold</div>
                    <div className={`mt-0.5 ${pnlClass(vsBench)}`}>{vsBench === null ? '–' : `${vsBench > 0 ? '+' : ''}${fmtNum(vsBench)} pts`}</div>
                  </div>
                  <div>
                    <div className="text-ink-3">Depuis le</div>
                    <div className="mt-0.5 text-ink">{fmtDate(bot.createdAt)}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
