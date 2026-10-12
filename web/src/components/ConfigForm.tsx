// Formulaire de configuration d'un bot (utilisé pour créer un bot et pour lancer un backtest).

import type { ReactNode } from 'react';
import type { AppConfig, BotConfig, Interval, StrategyInfo } from '../../../shared/types.ts';
import { SymbolPicker } from './SymbolPicker.tsx';
import { Card, cx, Field, inputClass } from './ui.tsx';

export type ConfigValue = Omit<BotConfig, 'name'>;

export function defaultParams(strategy: StrategyInfo | undefined): Record<string, number> {
  return Object.fromEntries((strategy?.params ?? []).map((p) => [p.key, p.default]));
}

export const DEFAULT_CONFIG: ConfigValue = {
  initialCapital: 10_000,
  symbols: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN'],
  strategy: 'sma_cross',
  params: { fast: 20, slow: 50 },
  interval: '15m',
  positionSizePct: 20,
  stopLossPct: 5,
  takeProfitPct: 10,
  feePct: 0.1,
  allowFractional: true,
};

const INTERVAL_HINTS: Record<Interval, string> = {
  '5m': 'Bot très actif : plusieurs trades par jour',
  '15m': 'Bon compromis pour une démonstration',
  '1h': 'Quelques trades par semaine',
  '1d': 'Investissement : quelques trades par mois',
};

function NumberInput({ value, onChange, min, max, step, suffix }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        className={cx(inputClass, 'num', suffix && 'pr-12')}
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">{suffix}</span>}
    </div>
  );
}

interface Props {
  value: ConfigValue;
  onChange: (v: ConfigValue) => void;
  strategies: StrategyInfo[];
  intervals: AppConfig['intervals'];
  /** Contenu supplémentaire affiché dans la section « Unité de temps » (ex. période du backtest). */
  intervalExtra?: ReactNode;
}

export function ConfigForm({ value, onChange, strategies, intervals, intervalExtra }: Props) {
  const set = <K extends keyof ConfigValue>(key: K, v: ConfigValue[K]) => onChange({ ...value, [key]: v });
  const strategy = strategies.find((s) => s.id === value.strategy);

  return (
    <div className="space-y-5">
      <Card title="1. Capital de départ">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Montant fictif confié au bot" hint="La devise est celle de la bourse des actions choisies (USD, CHF, EUR…).">
            <NumberInput value={value.initialCapital} min={100} step={100} onChange={(n) => set('initialCapital', n)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {[1_000, 10_000, 50_000, 100_000].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => set('initialCapital', n)}
                className={cx(
                  'num rounded-md px-2.5 py-1.5 text-xs ring-1',
                  value.initialCapital === n ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40' : 'text-slate-300 ring-slate-700 hover:bg-slate-800',
                )}
              >
                {n.toLocaleString('fr-CH')}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title="2. Actions suivies">
        <SymbolPicker value={value.symbols} onChange={(s) => set('symbols', s)} />
        <p className="mt-3 text-xs text-slate-400">
          Toutes les actions d'un bot doivent être cotées dans la même devise. Les symboles suisses se terminent par <code>.SW</code>.
        </p>
      </Card>

      <Card title="3. Stratégie de trading">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {strategies.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange({ ...value, strategy: s.id, params: defaultParams(s) })}
              className={cx(
                'rounded-lg border px-3 py-2.5 text-left transition-colors',
                s.id === value.strategy ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50',
              )}
            >
              <div className="text-sm font-semibold text-slate-100">{s.name}</div>
              <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">{s.rules.buy}</div>
            </button>
          ))}
        </div>

        {strategy && (
          <div className="mt-4 space-y-4 rounded-lg bg-slate-950/50 p-4">
            <p className="text-sm leading-relaxed text-slate-300">{strategy.description}</p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-emerald-200">
                <span className="font-semibold">Achat : </span>
                {strategy.rules.buy}
              </div>
              <div className="rounded-md bg-rose-500/10 px-3 py-2 text-rose-200">
                <span className="font-semibold">Vente : </span>
                {strategy.rules.sell}
              </div>
            </div>
            {strategy.params.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {strategy.params.map((p) => (
                  <Field key={p.key} label={p.label} hint={`${p.min} à ${p.max}`}>
                    <NumberInput
                      value={value.params[p.key] ?? p.default}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      onChange={(n) => set('params', { ...value.params, [p.key]: n })}
                    />
                  </Field>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="4. Unité de temps des bougies">
        <div className="grid gap-2 sm:grid-cols-4">
          {intervals.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onChange({ ...value, interval: it.id })}
              className={cx(
                'rounded-lg border px-3 py-2 text-left transition-colors',
                it.id === value.interval ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50',
              )}
            >
              <div className="text-sm font-semibold text-slate-100">{it.label}</div>
              <div className="text-xs text-slate-400">{INTERVAL_HINTS[it.id]}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Le bot analyse le marché à chaque nouvelle bougie clôturée. Les indicateurs (moyennes, RSI…) sont calculés sur ces bougies.
        </p>
        {intervalExtra && <div className="mt-4">{intervalExtra}</div>}
      </Card>

      <Card title="5. Gestion du risque">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Taille d'une position" hint="Part du portefeuille investie à chaque achat">
            <NumberInput value={value.positionSizePct} min={1} max={100} step={1} suffix="%" onChange={(n) => set('positionSizePct', n)} />
          </Field>
          <Field label="Stop-loss" hint="Vente automatique si la perte atteint ce seuil (0 = désactivé)">
            <NumberInput value={value.stopLossPct} min={0} max={90} step={0.5} suffix="%" onChange={(n) => set('stopLossPct', n)} />
          </Field>
          <Field label="Take-profit" hint="Vente automatique si le gain atteint ce seuil (0 = désactivé)">
            <NumberInput value={value.takeProfitPct} min={0} max={1000} step={0.5} suffix="%" onChange={(n) => set('takeProfitPct', n)} />
          </Field>
          <Field label="Frais de courtage" hint="Par ordre, en % du montant (réaliste : 0.05 à 0.5 %)">
            <NumberInput value={value.feePct} min={0} max={5} step={0.05} suffix="%" onChange={(n) => set('feePct', n)} />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-emerald-500"
            checked={value.allowFractional}
            onChange={(e) => set('allowFractional', e.target.checked)}
          />
          Autoriser les fractions d'actions (ex. 0.25 action, comme sur les néobanques)
        </label>
      </Card>
    </div>
  );
}

/** Vérifications simples avant l'envoi au serveur. */
export function validateConfig(v: ConfigValue): string | null {
  if (!Number.isFinite(v.initialCapital) || v.initialCapital < 100) return 'Le capital doit être d’au moins 100.';
  if (v.symbols.length === 0) return 'Choisissez au moins une action.';
  for (const [k, n] of Object.entries({ positionSizePct: v.positionSizePct, stopLossPct: v.stopLossPct, takeProfitPct: v.takeProfitPct, feePct: v.feePct })) {
    if (!Number.isFinite(n)) return `Valeur manquante : ${k}`;
  }
  if (Object.values(v.params).some((n) => !Number.isFinite(n))) return 'Un paramètre de la stratégie est vide.';
  return null;
}
