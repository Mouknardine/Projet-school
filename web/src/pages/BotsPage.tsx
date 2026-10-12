// Page d'accueil : liste des bots et leurs performances.

import { Link } from 'react-router';
import { useAppData } from '../App.tsx';
import { Sparkline } from '../components/charts.tsx';
import { Badge, Card, cx, ErrorBox, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDate, fmtMoney, fmtPct, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { usePolling } from '../lib/usePolling.ts';

export function BotsPage() {
  const { strategies } = useAppData();
  const { data, error, loading } = usePolling(() => api.bots(), [], 15_000);
  const strategyName = (id: string) => strategies.find((s) => s.id === id)?.short ?? id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Mes bots de trading</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Chaque bot reçoit un capital fictif et achète ou vend des actions selon sa stratégie, en suivant les cours réels du marché.
          </p>
        </div>
        <Link to="/bots/new" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
          + Nouveau bot
        </Link>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {loading && !data && <Spinner />}

      {data && data.length === 0 && (
        <Card>
          <div className="py-10 text-center">
            <p className="text-lg font-semibold text-slate-100">Aucun bot pour l'instant</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
              Créez votre premier bot : choisissez un capital, des actions et une stratégie. Il commencera à trader dès l'ouverture de la bourse.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Link to="/bots/new" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
                Créer un bot
              </Link>
              <Link to="/backtest" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
                Tester une stratégie sur le passé
              </Link>
            </div>
          </div>
        </Card>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map(({ bot, summary }) => {
            const vsBench = summary.benchmarkPnlPct !== null ? summary.pnlPct - summary.benchmarkPnlPct : null;
            return (
              <Link
                key={bot.id}
                to={`/bots/${bot.id}`}
                className="group rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-600 hover:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-100 group-hover:text-white">{bot.name}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-400">
                      {strategyName(bot.strategy)} · {bot.interval} · {bot.symbols.join(', ')}
                    </div>
                  </div>
                  <Badge tone={bot.status === 'running' ? 'green' : 'amber'}>{bot.status === 'running' ? 'Actif' : 'En pause'}</Badge>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <div className="num text-2xl font-semibold text-white">{fmtMoney(summary.equity, bot.currency)}</div>
                    <div className={cx('num text-sm font-medium', pnlClass(summary.pnl))}>
                      {fmtSignedMoney(summary.pnl, bot.currency)} ({fmtPct(summary.pnlPct)})
                    </div>
                  </div>
                  <Sparkline values={summary.sparkline} base={bot.initialCapital} className="h-10 w-32" />
                </div>
                <div className="num mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 pt-3 text-xs text-slate-400">
                  <span>{summary.tradesCount} trades</span>
                  <span>
                    vs Buy & Hold : <span className={pnlClass(vsBench)}>{vsBench === null ? '–' : `${vsBench > 0 ? '+' : ''}${vsBench.toFixed(2)} pts`}</span>
                  </span>
                  <span>depuis le {fmtDate(bot.createdAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
