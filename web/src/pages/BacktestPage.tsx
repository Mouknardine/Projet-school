// Backtest : rejouer une stratégie sur l'historique réel des cours.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { BacktestResult } from '../../../shared/types.ts';
import { useAppData } from '../App.tsx';
import { PerformanceChart, PriceChart, SERIES } from '../components/charts.tsx';
import { ConfigForm, DEFAULT_CONFIG, validateConfig, type ConfigValue } from '../components/ConfigForm.tsx';
import { TradesTable } from '../components/TradesTable.tsx';
import { Button, Card, cx, ErrorBox, InfoBox, StatTile as Kpi, Tabs } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, pnlClass } from '../lib/format.ts';

export function BacktestPage() {
  const { strategies, config } = useAppData();
  const navigate = useNavigate();
  const [value, setValue] = useState<ConfigValue>({ ...DEFAULT_CONFIG, interval: '1d' });
  const [range, setRange] = useState('2y');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const ranges = config.intervals.find((i) => i.id === value.interval)?.backtestRanges ?? [];
  const effectiveRange = ranges.some((r) => r.id === range) ? range : (ranges[ranges.length - 1]?.id ?? '1y');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validateConfig(value);
    if (invalid) return setError(invalid);
    setRunning(true);
    setError(null);
    try {
      setResult(await api.backtest({ ...value, range: effectiveRange }));
      setTimeout(() => document.getElementById('resultats')?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Backtest d'une stratégie</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-3">
          Le backtest rejoue la stratégie sur l'historique réel des cours, comme si le bot avait tourné pendant cette période. C'est la méthode utilisée
          par les professionnels pour évaluer un algorithme avant de lui confier de l'argent.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <ConfigForm
          value={value}
          onChange={setValue}
          strategies={strategies}
          intervals={config.intervals}
          intervalExtra={
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-ink-2">Période testée :</span>
              <Tabs value={effectiveRange} onChange={setRange} items={ranges.map((r) => ({ id: r.id, label: r.label }))} />
              {value.interval !== '1d' && <span className="text-xs text-ink0">Yahoo Finance limite l'historique des bougies intraday.</span>}
            </div>
          }
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={running} className="px-5 py-2">
            {running ? 'Calcul en cours…' : 'Lancer le backtest'}
          </Button>
        </div>
      </form>

      {result && <Results result={result} config={value} onLaunch={() => navigate('/bots/new', { state: { config: value } })} />}
    </div>
  );
}

function Results({ result, config, onLaunch }: { result: BacktestResult; config: ConfigValue; onLaunch: () => void }) {
  const { stats, currency } = result;
  const symbols = Object.keys(result.charts);
  const [symbol, setSymbol] = useState(symbols[0]);
  const current = symbols.includes(symbol) ? symbol : symbols[0];
  const diff = stats.totalReturnPct - stats.benchmarkReturnPct;
  const chart = result.charts[current];

  return (
    <div id="resultats" className="scroll-mt-20 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Résultats</h2>
          <p className="text-sm text-ink-3">
            Du {fmtDate(stats.startTime)} au {fmtDate(stats.endTime)} · bougies de {result.interval} · les {result.warmupBars} premières bougies servent à
            calculer les indicateurs
          </p>
        </div>
        <Button variant="primary" onClick={onLaunch}>
          Lancer ce bot sur les cours en direct →
        </Button>
      </div>

      <InfoBox>
        {diff >= 0 ? (
          <>
            La stratégie a fait <b>mieux</b> que le simple Buy & Hold de <b>{fmtNum(diff)} points</b>
          </>
        ) : (
          <>
            La stratégie a fait <b>moins bien</b> que le simple Buy & Hold de <b>{fmtNum(-diff)} points</b>
          </>
        )}{' '}
        ({fmtPct(stats.totalReturnPct)} contre {fmtPct(stats.benchmarkReturnPct)}). Côté risque, sa pire baisse a été de {fmtNum(stats.maxDrawdownPct)} %
        contre {fmtNum(stats.benchmarkMaxDrawdownPct)} % pour le Buy & Hold. Attention : un bon résultat passé ne garantit rien pour le futur
        (risque de « surapprentissage »).
      </InfoBox>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Rendement"
          value={fmtPct(stats.totalReturnPct)}
          valueClassName={pnlClass(stats.totalReturnPct)}
          sub={`Buy & Hold : ${fmtPct(stats.benchmarkReturnPct)}`}
        />
        <Kpi label="Valeur finale" value={fmtMoney(stats.finalEquity, currency)} sub={`Départ : ${fmtMoney(config.initialCapital, currency)}`} />
        <Kpi
          label="Drawdown max"
          value={`−${fmtNum(stats.maxDrawdownPct)} %`}
          valueClassName="text-down"
          sub={`Buy & Hold : −${fmtNum(stats.benchmarkMaxDrawdownPct)} %`}
        />
        <Kpi
          label="Ratio de Sharpe"
          value={stats.sharpe === null ? '–' : fmtNum(stats.sharpe)}
          sub={`Volatilité annuelle : ${stats.volatilityPct === null ? '–' : `${fmtNum(stats.volatilityPct)} %`}`}
        />
        <Kpi
          label="Trades clôturés"
          value={stats.closedTrades}
          sub={stats.winRate === null ? 'aucune vente' : `${fmtNum(stats.winRate, 0)} % gagnants`}
        />
        <Kpi
          label="Gain / perte moyen"
          value={
            <span>
              <span className="text-up">{fmtPct(stats.avgWinPct, 1)}</span> / <span className="text-down">{fmtPct(stats.avgLossPct, 1)}</span>
            </span>
          }
          sub={`Profit factor : ${stats.profitFactor === null ? '–' : fmtNum(stats.profitFactor)}`}
        />
        <Kpi label="Frais payés" value={fmtMoney(stats.feesPaid, currency)} sub={`${result.trades.length} ordres`} />
        <Kpi label="Temps investi" value={`${fmtNum(stats.exposurePct, 0)} %`} sub="du temps avec au moins une position" />
      </div>

      <Card>
        <PerformanceChart points={result.equity} initialCapital={config.initialCapital} currency={currency} title="Valeur du portefeuille simulé" ranges={[]} height={320} />
      </Card>

      <Card title="Cours, indicateurs et ordres simulés" actions={<Tabs value={current} onChange={setSymbol} items={symbols.map((s) => ({ id: s, label: s }))} />}>
        {chart && (
          <PriceChart
            key={current}
            bars={chart.bars}
            overlays={result.overlays}
            series={chart.series}
            trades={result.trades.filter((t) => t.symbol === current)}
            interval={result.interval}
            height={result.overlays.some((o) => o.pane === 'oscillator') ? 480 : 400}
          />
        )}
      </Card>

      {result.openPositions.length > 0 && (
        <Card title="Positions encore ouvertes à la fin du test">
          <div className="flex flex-wrap gap-3">
            {result.openPositions.map((p) => {
              const pct = (p.lastPrice / p.entryPrice - 1) * 100;
              return (
                <div key={p.symbol} className="num rounded-lg bg-page/60 px-3 py-2 text-sm">
                  <span className="font-semibold text-ink">{p.symbol}</span> · {fmtQty(p.qty)} × {fmtPrice(p.lastPrice)}{' '}
                  <span className={cx('text-xs', pnlClass(pct))}>({fmtPct(pct)})</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title={`Trades simulés (${result.trades.length})`}>
        <TradesTable trades={[...result.trades].reverse()} currency={currency} colorOf={(s) => SERIES[Math.max(0, symbols.indexOf(s)) % SERIES.length]} />
      </Card>
    </div>
  );
}
