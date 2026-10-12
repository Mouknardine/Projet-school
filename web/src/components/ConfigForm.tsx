// Formulaire de configuration d'un bot (utilisé pour créer un bot et pour lancer un backtest).

import { ChevronDown, ExternalLink } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { AppConfig, BotConfig, BrokerInfo, CostPreview, Interval, StrategyInfo } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, nbsp } from '../lib/format.ts';
import { SymbolPicker } from './SymbolPicker.tsx';
import { Card, cx, Field, inputClass } from './ui.tsx';

export type ConfigValue = Omit<BotConfig, 'name'>;

export function defaultParams(strategy: StrategyInfo | undefined): Record<string, number> {
  return Object.fromEntries((strategy?.params ?? []).map((p) => [p.key, p.default]));
}

export const DEFAULT_CONFIG: ConfigValue = {
  initialCapital: 10_000,
  symbols: ['AAPL', 'MSFT', 'NVDA', 'NESN.SW', 'MC.PA'],
  strategy: 'sma_cross',
  params: { fast: 20, slow: 50 },
  interval: '15m',
  positionSizePct: 20,
  stopLossPct: 5,
  takeProfitPct: 10,
  feePct: 0.1,
  allowFractional: true,
  currency: 'CHF',
  broker: 'yuh',
};

const CURRENCY_LABELS: Record<string, string> = { CHF: 'Franc suisse', EUR: 'Euro', USD: 'Dollar US' };

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
  brokers: BrokerInfo[];
  currencies: string[];
  /** Contenu supplémentaire affiché dans la section « Unité de temps » (ex. période du backtest). */
  intervalExtra?: ReactNode;
}

export function ConfigForm({ value, onChange, strategies, intervals, brokers, currencies, intervalExtra }: Props) {
  const set = <K extends keyof ConfigValue>(key: K, v: ConfigValue[K]) => onChange({ ...value, [key]: v });
  const strategy = strategies.find((s) => s.id === value.strategy);

  return (
    <div className="space-y-5">
      <Card title="1. Combien d'argent lui confier ?" subtitle="C'est de l'argent fictif : rien n'est débité.">
        <div className="space-y-4">
          <Field label="Devise du compte" hint="La monnaie de votre compte en banque. Les actions cotées dans une autre monnaie sont converties au vrai taux de change.">
            <div className="grid grid-cols-3 gap-2">
              {currencies.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('currency', c)}
                  className={cx(
                    'rounded-lg border px-3 py-2 text-left transition-colors',
                    value.currency === c ? 'border-accent/60 bg-accent/10' : 'border-line hover:border-line-strong hover:bg-raised/60',
                  )}
                >
                  <div className="text-sm font-semibold text-ink">{c}</div>
                  <div className="truncate text-xs text-ink-3">{CURRENCY_LABELS[c] ?? c}</div>
                </button>
              ))}
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Capital de départ">
              <NumberInput value={value.initialCapital} min={100} step={100} suffix={value.currency} onChange={(n) => set('initialCapital', n)} />
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
        </div>
      </Card>

      <Card title="2. Quelles actions doit-il surveiller ?" subtitle="Le bot pourra acheter et vendre uniquement ces actions.">
        <SymbolPicker value={value.symbols} onChange={(s) => set('symbols', s)} />
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Vous pouvez mélanger les bourses : suisse (symboles en <code>.SW</code>), américaine (sans suffixe), Paris (<code>.PA</code>), Londres (<code>.L</code>)…
          Les prix sont convertis au taux de change du moment, et le change est facturé comme à la banque.
        </p>
      </Card>

      <Card title="3. Chez quelle banque ?" subtitle="Le bot paie les vrais frais de cette banque : courtage, change et taxes.">
        <BrokerPicker value={value} onChange={onChange} brokers={brokers} />
        <CostPreviewBox value={value} />
      </Card>

      <Card title="4. Quelle stratégie doit-il suivre ?" subtitle="La règle qui lui dit quand acheter et quand vendre.">
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

      <Card title="5. À quel rythme doit-il décider ?" subtitle="La durée d'une « bougie » : le bot résume les prix par tranches de cette durée.">
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

      <Card title="6. Quelles règles de prudence ?" subtitle="Pour limiter les pertes (en finance : la gestion du risque).">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Part investie par achat" hint="Pour ne pas tout miser sur une seule action">
            <NumberInput value={value.positionSizePct} min={1} max={100} step={1} suffix="%" onChange={(n) => set('positionSizePct', n)} />
          </Field>
          <Field label="Vente auto. si perte de… (stop-loss)" hint="Le bot revend si l'action perd ce pourcentage (0 = jamais)">
            <NumberInput value={value.stopLossPct} min={0} max={90} step={0.5} suffix="%" onChange={(n) => set('stopLossPct', n)} />
          </Field>
          <Field label="Vente auto. si gain de… (objectif)" hint="Le bot revend si l'action gagne ce pourcentage (0 = jamais)">
            <NumberInput value={value.takeProfitPct} min={0} max={1000} step={0.5} suffix="%" onChange={(n) => set('takeProfitPct', n)} />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={value.allowFractional}
            onChange={(e) => set('allowFractional', e.target.checked)}
          />
          Autoriser les fractions d'actions (ex. 0.25 action, possible chez Yuh, Swissquote, PostFinance et Interactive Brokers pour beaucoup d'actions)
        </label>
      </Card>
    </div>
  );
}

function BrokerPicker({ value, onChange, brokers }: { value: ConfigValue; onChange: (v: ConfigValue) => void; brokers: BrokerInfo[] }) {
  const selected = brokers.find((b) => b.id === value.broker);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {brokers.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange({ ...value, broker: b.id })}
            className={cx(
              'rounded-lg border px-3 py-2.5 text-left transition-colors',
              b.id === value.broker ? 'border-accent/60 bg-accent/10' : 'border-line hover:border-line-strong hover:bg-raised/60',
            )}
          >
            <div className="text-sm font-semibold text-ink">{b.name}</div>
            <div className="mt-0.5 text-xs text-ink-3">{b.kind}</div>
          </button>
        ))}
      </div>
      {selected && (
        <div className="space-y-3 rounded-lg bg-page/60 p-4">
          <p className="text-sm leading-relaxed text-ink-2">{selected.description}</p>
          <ul className="space-y-1.5 text-sm text-ink-2">
            {selected.fees.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                <span>{nbsp(f)}</span>
              </li>
            ))}
          </ul>
          {selected.id === 'simple' ? (
            <Field label="Frais par achat ou vente" hint="Réaliste : 0.05 à 0.5 %">
              <NumberInput value={value.feePct} min={0} max={5} step={0.05} suffix="%" onChange={(n) => onChange({ ...value, feePct: n })} />
            </Field>
          ) : (
            selected.source && (
              <a href={selected.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline">
                Tarifs officiels de {selected.name} <ExternalLink className="size-3" />
              </a>
            )
          )}
        </div>
      )}
    </div>
  );
}

/** Ce que coûteraient vraiment, aujourd'hui, un achat puis une revente de chaque action choisie. */
function CostPreviewBox({ value }: { value: ConfigValue }) {
  const amount = (value.initialCapital * value.positionSizePct) / 100;
  const [preview, setPreview] = useState<CostPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const symbolsKey = value.symbols.join(',');
  const ready = Number.isFinite(amount) && amount >= 1 && value.symbols.length > 0 && Number.isFinite(value.feePct);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .costPreview({ broker: value.broker, currency: value.currency, amount, feePct: value.feePct, fractional: value.allowFractional, symbols: symbolsKey.split(',') })
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          setError(null);
        })
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
        .finally(() => !cancelled && setLoading(false));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, value.broker, value.currency, amount, value.feePct, value.allowFractional, symbolsKey]);

  if (!ready) return null;
  const cur = value.currency;
  return (
    <div className="mt-4 rounded-lg border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Combien coûte un achat, puis sa revente&nbsp;?</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            Pour un achat de {fmtMoney(amount, cur, 0)} ({fmtNum(value.positionSizePct, 0)} % du capital, réglable à l'étape 6), aux cours et taux de change actuels.
          </p>
        </div>
        {loading && <span className="mt-1 size-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-label="Calcul…" />}
      </div>
      {error && <p className="mt-3 text-xs text-[#ffb3bd]">Aperçu indisponible : {error}</p>}
      {preview && (
        <div className={cx('mt-3 divide-y divide-line', loading && 'opacity-60')}>
          {preview.items.map((it) => (
            <details key={it.symbol} className="group py-2.5">
              <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">
                    {it.symbol} <span className="font-normal text-ink-3">· {it.name}</span>
                  </div>
                  <div className="text-xs text-ink-3">
                    Frais : {fmtMoney(it.buyTotal, cur)} à l'achat + {fmtMoney(it.sellTotal, cur)} à la revente
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-sm font-semibold text-warn">{fmtPct(it.breakEvenPct, 2, false)}</div>
                  <div className="text-[11px] text-ink-3">à regagner</div>
                </div>
                <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 space-y-2 rounded-md bg-page/60 p-3 text-xs text-ink-2">
                <p>
                  {fmtQty(it.qty)} action{it.qty > 1 ? 's' : ''} à {fmtPrice(it.price)} {it.currency}
                  {it.currency !== cur && (
                    <>
                      {' '}
                      · taux de change : 1 {it.currency} = {fmtNum(it.fxRate, 4)} {cur}
                    </>
                  )}{' '}
                  → {fmtMoney(it.value, cur)}
                </p>
                <CostLines title="À l'achat" lines={it.buy} currency={cur} />
                <CostLines title="À la revente (au même cours)" lines={it.sell} currency={cur} />
                <p className="text-ink-3">
                  L'action doit donc monter d'environ {fmtPct(it.breakEvenPct, 2, false)} avant que le bot gagne quelque chose.
                </p>
              </div>
            </details>
          ))}
          {preview.errors.map((e) => (
            <p key={e} className="py-2 text-xs text-ink-3">
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function CostLines({ title, lines, currency }: { title?: string; lines: { label: string; amount: number; detail: string }[]; currency: string }) {
  return (
    <div>
      {title && <div className="mb-1 font-semibold text-ink">{title}</div>}
      {lines.length === 0 ? (
        <div className="text-ink-3">Aucun frais</div>
      ) : (
        <ul className="space-y-1">
          {lines.map((l) => (
            <li key={l.label} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                {l.label} <span className="text-ink-3">({nbsp(l.detail)})</span>
              </span>
              <span className="num shrink-0 text-ink">{fmtMoney(l.amount, currency)}</span>
            </li>
          ))}
        </ul>
      )}
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
