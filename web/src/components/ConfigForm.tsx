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
  '5m': 'Très actif : plusieurs trades par jour',
  '15m': 'Bon compromis pour une démonstration',
  '1h': 'Quelques trades par semaine',
  '1d': 'Long terme : quelques trades par mois',
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
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-3">{suffix}</span>}
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
      <Card title="1. Combien d'argent lui confier ?" subtitle="C'est de l'argent fictif : rien n'est débité.">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Capital de départ" hint="La devise est celle de la bourse des actions choisies (USD, CHF, EUR…).">
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
                  value.initialCapital === n ? 'bg-accent/15 text-accent-text ring-accent/40' : 'text-ink-2 ring-line hover:bg-raised',
                )}
              >
                {n.toLocaleString('fr-CH')}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title="2. Quelles actions doit-il surveiller ?" subtitle="Le bot pourra acheter et vendre uniquement ces actions.">
        <SymbolPicker value={value.symbols} onChange={(s) => set('symbols', s)} />
        <p className="mt-3 text-xs text-ink-3">
          Toutes les actions d'un bot doivent être cotées dans la même devise. Les symboles suisses se terminent par <code>.SW</code>.
        </p>
      </Card>

      <Card title="3. Quelle stratégie doit-il suivre ?" subtitle="La règle qui lui dit quand acheter et quand vendre.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {strategies.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange({ ...value, strategy: s.id, params: defaultParams(s) })}
              className={cx(
                'rounded-lg border px-3 py-2.5 text-left transition-colors',
                s.id === value.strategy ? 'border-accent/60 bg-accent/10' : 'border-line hover:border-line-strong hover:bg-raised/60',
              )}
            >
              <div className="text-sm font-semibold text-ink">{s.name}</div>
              <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">Achète quand : {s.rules.buy.charAt(0).toLowerCase() + s.rules.buy.slice(1)}</div>
            </button>
          ))}
        </div>

        {strategy && (
          <div className="mt-4 space-y-4 rounded-lg bg-page/60 p-4">
            <p className="text-sm leading-relaxed text-ink-2">{strategy.description}</p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-md bg-up/10 px-3 py-2 text-[#a7e9cc]">
                <span className="font-semibold">Il achète quand : </span>
                {strategy.rules.buy}
              </div>
              <div className="rounded-md bg-down/10 px-3 py-2 text-[#ffb3bd]">
                <span className="font-semibold">Il vend quand : </span>
                {strategy.rules.sell}
              </div>
            </div>
            {strategy.params.length > 0 && (
              <div>
                <div className="mb-3 text-xs text-ink-3">Réglages de la stratégie (les valeurs proposées conviennent très bien) :</div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {strategy.params.map((p) => (
                    <Field key={p.key} label={p.label} hint={`${p.help ? `${p.help} · ` : ''}de ${p.min} à ${p.max}`}>
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
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="4. À quel rythme doit-il décider ?" subtitle="La durée d'une « bougie » : le bot résume les prix par tranches de cette durée.">
        <div className="grid gap-2 sm:grid-cols-4">
          {intervals.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onChange({ ...value, interval: it.id })}
              className={cx(
                'rounded-lg border px-3 py-2 text-left transition-colors',
                it.id === value.interval ? 'border-accent/60 bg-accent/10' : 'border-line hover:border-line-strong hover:bg-raised/60',
              )}
            >
              <div className="text-sm font-semibold text-ink">{it.label}</div>
              <div className="text-xs text-ink-3">{INTERVAL_HINTS[it.id]}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-3">
          Le bot prend une décision à chaque fois qu'une bougie se termine : toutes les 15 minutes pour des bougies de 15 min. Les indicateurs (moyennes, RSI…)
          sont calculés sur ces bougies.
        </p>
        {intervalExtra && <div className="mt-4">{intervalExtra}</div>}
      </Card>

      <Card title="5. Quelles règles de prudence ?" subtitle="Pour limiter les pertes (en finance : la gestion du risque).">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Part investie par achat" hint="Pour ne pas tout miser sur une seule action">
            <NumberInput value={value.positionSizePct} min={1} max={100} step={1} suffix="%" onChange={(n) => set('positionSizePct', n)} />
          </Field>
          <Field label="Vente auto. si perte de… (stop-loss)" hint="Le bot revend si l'action perd ce pourcentage (0 = jamais)">
            <NumberInput value={value.stopLossPct} min={0} max={90} step={0.5} suffix="%" onChange={(n) => set('stopLossPct', n)} />
          </Field>
          <Field label="Vente auto. si gain de… (objectif)" hint="Le bot revend si l'action gagne ce pourcentage (0 = jamais)">
            <NumberInput value={value.takeProfitPct} min={0} max={1000} step={0.5} suffix="%" onChange={(n) => set('takeProfitPct', n)} />
          </Field>
          <Field label="Frais par achat ou vente" hint="Comme une vraie banque (réaliste : 0.05 à 0.5 %)">
            <NumberInput value={value.feePct} min={0} max={5} step={0.05} suffix="%" onChange={(n) => set('feePct', n)} />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
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
