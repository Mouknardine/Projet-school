// Dashboard d'un bot : performance, positions, graphiques, historique des trades et journal.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { BotDetail, LogEntry, LogLevel } from '../../../shared/types.ts';
import { useAppData } from '../App.tsx';
import { EquityChart, PriceChart } from '../components/charts.tsx';
import { TradesTable } from '../components/TradesTable.tsx';
import { Badge, Button, Card, cx, Dot, ErrorBox, Kpi, Spinner, Tabs } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDateTime, fmtMoney, fmtPct, fmtPrice, fmtQty, fmtRelative, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { useNow, usePolling } from '../lib/usePolling.ts';

const LEVELS: Record<LogLevel, { label: string; tone: 'green' | 'sky' | 'slate' | 'amber' | 'red' }> = {
  trade: { label: 'Trade', tone: 'green' },
  signal: { label: 'Signal', tone: 'sky' },
  info: { label: 'Info', tone: 'slate' },
  warn: { label: 'Alerte', tone: 'amber' },
  error: { label: 'Erreur', tone: 'red' },
};

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

  const refreshAll = (d?: BotDetail) => {
    if (d) detail.setData(d);
    else detail.reload();
    equity.reload();
    trades.reload();
    logs.reload();
  };

  const run = async (label: string, fn: () => Promise<BotDetail | void>) => {
    setBusy(label);
    setActionError(null);
    try {
      const d = await fn();
      refreshAll(d ?? undefined);
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
  const vsBench = summary.benchmarkPnlPct !== null ? summary.pnlPct - summary.benchmarkPnlPct : null;
  const investedPct = summary.equity > 0 ? (summary.positionsValue / summary.equity) * 100 : 0;
  const anyMarketOpen = watchlist.some((w) => w.marketOpen);

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/" className="text-xs text-slate-400 hover:text-slate-200">
            ← Mes bots
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">{bot.name}</h1>
            <Badge tone={bot.status === 'running' ? 'green' : 'amber'}>
              <Dot on={bot.status === 'running' && anyMarketOpen} />
              {bot.status === 'running' ? (anyMarketOpen ? 'Actif — marché ouvert' : 'Actif — marché fermé') : 'En pause'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {strategy.name} · bougies de {bot.interval} · capital initial {fmtMoney(bot.initialCapital, cur)} · lancé le {fmtDateTime(bot.createdAt)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Dernière analyse {fmtRelative(bot.lastTickAt, now)} · analyse automatique toutes les {config.tickSeconds} s
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!!busy} onClick={() => run('tick', () => api.tick(bot.id))}>
            {busy === 'tick' ? 'Analyse…' : '↻ Analyser maintenant'}
          </Button>
          <Button
            disabled={!!busy}
            onClick={() => run('status', () => api.updateBot(bot.id, { status: bot.status === 'running' ? 'paused' : 'running' }))}
          >
            {bot.status === 'running' ? '❚❚ Pause' : '▶ Reprendre'}
          </Button>
          <Button
            variant="danger"
            disabled={!!busy}
            onClick={() => {
              if (confirm(`Réinitialiser « ${bot.name} » ? Toutes les positions et l'historique seront effacés, le capital revient à ${fmtMoney(bot.initialCapital, cur)}.`))
                run('reset', () => api.reset(bot.id));
            }}
          >
            Réinitialiser
          </Button>
          <Button
            variant="danger"
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
            Supprimer
          </Button>
        </div>
      </div>

      {actionError && <ErrorBox>{actionError}</ErrorBox>}
      {bot.lastError && <ErrorBox>Problème lors de la dernière analyse : {bot.lastError}</ErrorBox>}

      {/* Chiffres clés */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Valeur du portefeuille" value={fmtMoney(summary.equity, cur)} sub={`Départ : ${fmtMoney(bot.initialCapital, cur)}`} />
        <Kpi
          label="Performance"
          value={fmtPct(summary.pnlPct)}
          valueClassName={pnlClass(summary.pnl)}
          sub={<span className={pnlClass(summary.pnl)}>{fmtSignedMoney(summary.pnl, cur)}</span>}
        />
        <Kpi
          label="vs Buy & Hold"
          value={vsBench === null ? '–' : `${vsBench > 0 ? '+' : ''}${vsBench.toFixed(2)} pts`}
          valueClassName={pnlClass(vsBench)}
          sub={`Buy & Hold : ${fmtPct(summary.benchmarkPnlPct)}`}
        />
        <Kpi label="Liquidités" value={fmtMoney(summary.cash, cur)} sub={`Investi : ${fmtNumPct(investedPct)}`} />
        <Kpi
          label="Trades"
          value={summary.tradesCount}
          sub={summary.closedTrades ? `${summary.closedTrades} ventes · ${fmtNumPct(summary.winRate ?? 0)} gagnantes` : 'aucune vente encore'}
        />
        <Kpi
          label="Drawdown max"
          value={summary.maxDrawdownPct > 0 ? `−${summary.maxDrawdownPct.toFixed(2)} %` : '0 %'}
          valueClassName={summary.maxDrawdownPct > 0 ? 'text-rose-300' : undefined}
          sub={`Frais payés : ${fmtMoney(summary.feesPaid, cur)}`}
        />
      </div>

      {/* Courbe de performance + actions suivies */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Évolution de la valeur du portefeuille" className="lg:col-span-2">
          {equity.data && equity.data.length >= 2 ? (
            <EquityChart points={equity.data} initialCapital={bot.initialCapital} currency={cur} intraday />
          ) : (
            <p className="py-16 text-center text-sm text-slate-400">La courbe apparaîtra après les premières analyses du bot.</p>
          )}
        </Card>
        <Card title="Actions suivies" bodyClassName="p-0">
          <ul className="divide-y divide-slate-800">
            {watchlist.map((w) => {
              const held = positions.some((p) => p.symbol === w.symbol);
              return (
                <li key={w.symbol} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Dot on={w.marketOpen} />
                    <span className="font-semibold text-slate-100">{w.symbol}</span>
                    {held && <Badge tone="green">en portefeuille</Badge>}
                  </div>
                  <div className="num text-right text-sm">
                    <div className="text-slate-100">{fmtPrice(w.price)}</div>
                    <div className={cx('text-xs', pnlClass(w.sinceStartPct))} title="Variation depuis le lancement du bot">
                      {fmtPct(w.sinceStartPct)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-800 px-4 py-3">
            <div className="mb-1.5 flex justify-between text-xs text-slate-400">
              <span>Investi {fmtNumPct(investedPct)}</span>
              <span>Liquidités {fmtNumPct(100 - investedPct)}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="bg-emerald-500" style={{ width: `${Math.min(100, investedPct)}%` }} />
            </div>
          </div>
        </Card>
      </div>

      {/* Positions ouvertes */}
      <Card title={`Positions ouvertes (${positions.length})`} bodyClassName={positions.length ? 'p-0' : undefined}>
        {positions.length === 0 ? (
          <p className="text-sm text-slate-400">Aucune position : tout le capital est en liquidités.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-2 py-2 text-right font-medium">Quantité</th>
                  <th className="px-2 py-2 text-right font-medium">Prix d'achat</th>
                  <th className="px-2 py-2 text-right font-medium">Cours actuel</th>
                  <th className="px-2 py-2 text-right font-medium">Valeur</th>
                  <th className="px-2 py-2 text-right font-medium">Gain / perte latent</th>
                  <th className="px-2 py-2 text-right font-medium">Stop / objectif</th>
                  <th className="px-2 py-2 font-medium">Depuis</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.symbol} className="border-b border-slate-800/60 last:border-0">
                    <td className="px-4 py-2.5 font-semibold text-slate-100">{p.symbol}</td>
                    <td className="px-2 py-2.5 text-right">{fmtQty(p.qty)}</td>
                    <td className="px-2 py-2.5 text-right">{fmtPrice(p.entryPrice)}</td>
                    <td className="px-2 py-2.5 text-right">{fmtPrice(p.lastPrice)}</td>
                    <td className="px-2 py-2.5 text-right">{fmtMoney(p.marketValue, cur)}</td>
                    <td className={cx('px-2 py-2.5 text-right font-medium', pnlClass(p.unrealizedPnl))}>
                      {fmtSignedMoney(p.unrealizedPnl, cur)} <span className="text-xs">({fmtPct(p.unrealizedPnlPct)})</span>
                    </td>
                    <td className="px-2 py-2.5 text-right text-xs text-slate-400">
                      <span className="text-rose-300">{fmtPrice(p.stopLossPrice)}</span> / <span className="text-emerald-300">{fmtPrice(p.takeProfitPrice)}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs text-slate-400">{fmtRelative(p.openedAt, now)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        className="px-2 py-1 text-xs"
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
      <SymbolChart botId={bot.id} symbols={bot.symbols} tradesVersion={summary.tradesCount} />

      {/* Historique + journal */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card
          title={`Historique des trades (${summary.tradesCount})`}
          className="xl:col-span-2"
          actions={
            <a href={api.csvUrl(bot.id)} className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800">
              Exporter en CSV (Excel)
            </a>
          }
        >
          {trades.data ? <TradesTable trades={trades.data} currency={cur} /> : <Spinner />}
        </Card>
        <Journal logs={logs.data} />
      </div>
    </div>
  );
}

function fmtNumPct(n: number) {
  return `${n.toFixed(0)} %`;
}

function SymbolChart({ botId, symbols, tradesVersion }: { botId: number; symbols: string[]; tradesVersion: number }) {
  const [symbol, setSymbol] = useState(symbols[0]);
  useEffect(() => {
    if (!symbols.includes(symbol)) setSymbol(symbols[0]);
  }, [symbols, symbol]);
  const chart = usePolling(() => api.chart(botId, symbol), [botId, symbol, tradesVersion], 30_000);
  const q = chart.data?.quote;
  const change = q && q.previousClose ? (q.price / q.previousClose - 1) * 100 : null;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Cours et signaux</span>
          {q && (
            <span className="num text-xs font-normal text-slate-400">
              {q.name} · <span className="text-slate-100">{fmtPrice(q.price)} {q.currency}</span>{' '}
              <span className={pnlClass(change)}>{fmtPct(change)} aujourd'hui</span> · {q.exchange} ·{' '}
              {q.marketOpen ? <span className="text-emerald-400">marché ouvert</span> : 'marché fermé'}
            </span>
          )}
        </span>
      }
      actions={<Tabs value={symbol} onChange={setSymbol} items={symbols.map((s) => ({ id: s, label: s }))} />}
    >
      {chart.error && !chart.data && <ErrorBox>{chart.error}</ErrorBox>}
      {!chart.data && !chart.error && <Spinner />}
      {chart.data && (
        <PriceChart
          bars={chart.data.bars}
          overlays={chart.data.overlays}
          series={chart.data.series}
          trades={chart.data.trades}
          interval={chart.data.interval}
          height={chart.data.overlays.some((o) => o.pane === 'oscillator') ? 480 : 400}
          initialBars={150}
        />
      )}
    </Card>
  );
}

function Journal({ logs }: { logs: LogEntry[] | null }) {
  const [showAnalyses, setShowAnalyses] = useState(true);
  const visible = (logs ?? []).filter((l) => showAnalyses || l.level !== 'info');
  return (
    <Card
      title="Journal du bot"
      bodyClassName="p-0"
      actions={
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" className="accent-emerald-500" checked={showAnalyses} onChange={(e) => setShowAnalyses(e.target.checked)} />
          Afficher les analyses
        </label>
      }
    >
      {!logs ? (
        <div className="px-4">
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-400">Rien à afficher pour l'instant.</p>
      ) : (
        <ul className="max-h-[640px] divide-y divide-slate-800/70 overflow-y-auto">
          {visible.map((l) => (
            <li key={l.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="num text-slate-500">{fmtDateTime(l.time)}</span>
                <Badge tone={LEVELS[l.level].tone}>{LEVELS[l.level].label}</Badge>
                {l.symbol && <span className="font-semibold text-slate-300">{l.symbol}</span>}
              </div>
              <p className={cx('mt-1 text-sm leading-snug', l.level === 'trade' ? 'text-slate-100' : 'text-slate-400')}>{l.message}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
