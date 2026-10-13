// Backtest (« tester sur le passé ») : rejouer une stratégie sur l'historique réel des cours.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { BacktestResult, StrategyInfo } from '../../../shared/types.ts';
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
        <div className="text-xs font-semibold uppercase tracking-wider text-warn">Mode expert</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Tester une stratégie sur le passé</h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">
          Avant de lancer un bot, on peut vérifier ce qu'aurait donné sa stratégie ces derniers mois. L'app rejoue les vrais cours du passé, jour après jour,
          comme si le bot avait tourné à ce moment-là. En finance, on appelle ça un <b className="font-semibold text-ink">backtest</b>.
        </p>
        <p className="mt-1.5 max-w-3xl text-sm text-ink-3">Le résultat s'affiche en quelques secondes. Rien n'est acheté pour de vrai.</p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <ConfigForm
          value={value}
          onChange={setValue}
          strategies={strategies}
          intervals={config.intervals}
          brokers={config.brokers ?? []}
          currencies={config.accountCurrencies ?? ['CHF', 'EUR', 'USD']}
          intervalExtra={
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-ink-2">Période testée :</span>
              <Tabs value={effectiveRange} onChange={setRange} items={ranges.map((r) => ({ id: r.id, label: r.label }))} />
              {value.interval !== '1d' && <span className="text-xs text-ink-3">Pour des bougies de moins d'un jour, Yahoo Finance ne fournit que quelques semaines d'historique.</span>}
            </div>
          }
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={running} className="px-5 py-2">
            {running ? 'Calcul en cours…' : 'Lancer le test'}
          </Button>
        </div>
      </form>

      {result && (
        <Results
          result={result}
          config={value}
          strategy={strategies.find((s) => s.id === value.strategy)}
          onLaunch={() => navigate('/bots/new', { state: { config: value } })}
        />
      )}
    </div>
  );
}

function Results({ result, config, strategy, onLaunch }: { result: BacktestResult; config: ConfigValue; strategy?: StrategyInfo; onLaunch: () => void }) {
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
          <h2 className="text-xl font-semibold text-ink">Résultat du test</h2>
          <p className="text-sm text-ink-3">
            Du {fmtDate(stats.startTime)} au {fmtDate(stats.endTime)}. Les {result.warmupBars} premières bougies servent seulement à calculer les indicateurs.
          </p>
        </div>
        <Button variant="primary" onClick={onLaunch}>
          Lancer ce bot pour de vrai (argent fictif) →
        </Button>
      </div>

      <InfoBox>
        {diff >= 0 ? (
          <>
            Sur cette période, la stratégie a fait <b>mieux</b> que simplement acheter les actions au départ et les garder (« acheter et garder »), de{' '}
            <b>{fmtNum(diff)} points</b>
          </>
        ) : (
          <>
            Sur cette période, la stratégie a fait <b>moins bien</b> que simplement acheter les actions au départ et les garder (« acheter et garder »), de{' '}
            <b>{fmtNum(-diff)} points</b>
          </>
        )}{' '}
        ({fmtPct(stats.totalReturnPct)} contre {fmtPct(stats.benchmarkReturnPct)}). Côté risque, sa pire chute a été de {fmtNum(stats.maxDrawdownPct)} %, contre{' '}
        {fmtNum(stats.benchmarkMaxDrawdownPct)} % en achetant et gardant. Attention : un bon résultat dans le passé ne garantit rien pour le futur.
      </InfoBox>

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-4">
        <Kpi
          label="Gain ou perte"
          value={fmtPct(stats.totalReturnPct)}
          valueClassName={pnlClass(stats.totalReturnPct)}
          sub={`acheter et garder : ${fmtPct(stats.benchmarkReturnPct)}`}
          help="De combien la valeur du bot a monté ou baissé sur toute la période testée, frais compris. À comparer avec « acheter et garder » : les mêmes actions achetées au départ et jamais revendues."
        />
        <Kpi
          label="Valeur à la fin"
          value={fmtMoney(stats.finalEquity, currency)}
          sub={`départ : ${fmtMoney(config.initialCapital, currency)}`}
          help="Ce que vaudrait le bot à la fin de la période : liquidités + actions encore possédées."
        />
        <Kpi
          label="Pire chute"
          value={`−${fmtNum(stats.maxDrawdownPct)} %`}
          valueClassName="text-down"
          sub={`acheter et garder : −${fmtNum(stats.benchmarkMaxDrawdownPct)} %`}
          help="La plus forte baisse de la valeur du bot entre un sommet et le creux suivant (« drawdown maximal »). Plus elle est petite, moins la stratégie est risquée."
        />
        <Kpi
          label="Ratio de Sharpe"
          value={stats.sharpe === null ? '–' : fmtNum(stats.sharpe)}
          sub={`volatilité : ${stats.volatilityPct === null ? '–' : `${fmtNum(stats.volatilityPct)} % par an`}`}
          help="Note qui compare le gain au risque pris (les variations de valeur). Au-dessus de 1, le gain compense bien le risque ; sous 0, la stratégie a perdu de l'argent. La volatilité mesure à quel point la valeur bouge."
        />
        <Kpi
          label="Ventes"
          value={stats.closedTrades}
          sub={stats.winRate === null ? 'aucune vente' : `${fmtNum(stats.winRate, 0)} % gagnantes`}
          help="Nombre d'actions achetées puis revendues pendant le test, et la part de ces ventes qui ont rapporté de l'argent."
        />
        <Kpi
          label="Gain / perte moyen"
          value={
            <span>
              <span className="text-up">{fmtPct(stats.avgWinPct, 1)}</span> / <span className="text-down">{fmtPct(stats.avgLossPct, 1)}</span>
            </span>
          }
          sub={`profit factor : ${stats.profitFactor === null ? '–' : fmtNum(stats.profitFactor)}`}
          help="Gain moyen d'une vente gagnante et perte moyenne d'une vente perdante. Le « profit factor » divise la somme des gains par la somme des pertes : au-dessus de 1, la stratégie gagne plus qu'elle ne perd."
        />
        <Kpi
          label="Frais payés"
          value={fmtMoney(stats.feesPaid, currency)}
          sub={`${result.trades.length} achats et ventes`}
          help="Courtage, frais de change, droit de timbre et taxes, selon la banque choisie, au taux de change de chaque jour. Une stratégie qui fait beaucoup de trades en paie beaucoup."
        />
        <Kpi
          label="Temps investi"
          value={`${fmtNum(stats.exposurePct, 0)} %`}
          sub="du temps avec au moins une action"
          help="Part du temps pendant laquelle le bot possédait au moins une action. Le reste du temps, l'argent attendait en liquidités."
        />
      </div>

      <Card>
        <PerformanceChart points={result.equity} initialCapital={config.initialCapital} currency={currency} title="Valeur du bot simulé" ranges={[]} height={320} />
      </Card>

      <Card title="Graphique : cours, indicateurs et décisions simulées" actions={<Tabs value={current} onChange={setSymbol} items={symbols.map((s) => ({ id: s, label: s }))} />}>
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
        <Card title="Actions encore possédées à la fin du test">
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

      <Card title={`Les trades simulés et leurs raisons (${result.trades.length})`} subtitle="Touchez un trade pour lire l'explication complète.">
        <TradesTable
          trades={[...result.trades].reverse()}
          currency={currency}
          colorOf={(s) => SERIES[Math.max(0, symbols.indexOf(s)) % SERIES.length]}
          context={{ strategy, stopLossPct: config.stopLossPct, takeProfitPct: config.takeProfitPct }}
        />
      </Card>
    </div>
  );
}
