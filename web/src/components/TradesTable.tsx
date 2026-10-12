// Historique des trades : chaque ordre passé par le bot, avec une explication claire de la décision.
// Toucher un trade ouvre sa fiche complète : pourquoi, combien, et (pour une vente) le résultat.

import { ArrowDownRight, ArrowUpRight, ChevronRight, Hand, ShieldAlert, Target, Zap } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { StrategyInfo, Trade, TradeTrigger } from '../../../shared/types.ts';
import { fmtDateTime, fmtDuration, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, fmtSignedMoney, nbsp, pnlClass } from '../lib/format.ts';
import { Badge, cx, EmptyState, Segmented, Sheet } from './ui.tsx';

type Row = Omit<Trade, 'id' | 'botId'> & { id?: number };

/** Ce qu'il faut savoir du bot pour expliquer ses trades. */
export interface TradeContext {
  strategy?: StrategyInfo;
  stopLossPct?: number;
  takeProfitPct?: number;
  /** Nom complet de chaque action (ex. AAPL → Apple Inc.). */
  names?: Record<string, string | null>;
}

const TRIGGERS: Record<TradeTrigger, { chip: string; long: string; icon: typeof Zap; tone: 'accent' | 'down' | 'up' | 'neutral' }> = {
  signal: { chip: 'Décision de la stratégie', long: 'Décision prise par la stratégie du bot', icon: Zap, tone: 'accent' },
  stop_loss: { chip: 'Stop-loss', long: 'Vente automatique pour limiter la perte (stop-loss)', icon: ShieldAlert, tone: 'down' },
  take_profit: { chip: 'Objectif atteint', long: 'Vente automatique, objectif de gain atteint (take-profit)', icon: Target, tone: 'up' },
  manual: { chip: 'Vente à la main', long: "Vente demandée à la main, ce n'est pas une décision du bot", icon: Hand, tone: 'neutral' },
};

const selectClass = 'h-[30px] rounded-lg border border-line bg-page px-2 text-xs text-ink-2 outline-none focus:border-accent';

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (t: number) => new Date(t).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** L'achat qui a ouvert la position fermée par cette vente (le dernier achat du même titre avant elle). */
function entryOf(sell: Row, trades: Row[]): Row | undefined {
  return trades.filter((t) => t.symbol === sell.symbol && t.side === 'BUY' && t.time <= sell.time).sort((a, b) => b.time - a.time)[0];
}

/** La vente qui a fermé la position ouverte par cet achat, s'il y en a eu une. */
function exitOf(buy: Row, trades: Row[]): Row | undefined {
  return trades.filter((t) => t.symbol === buy.symbol && t.side === 'SELL' && t.time >= buy.time).sort((a, b) => a.time - b.time)[0];
}

export function TradesTable({ trades, currency, pageSize = 20, colorOf, context = {} }: {
  trades: Row[];
  currency: string;
  pageSize?: number;
  colorOf?: (symbol: string) => string;
  context?: TradeContext;
}) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<'all' | 'BUY' | 'SELL'>('all');
  const [limit, setLimit] = useState(pageSize);
  const [selected, setSelected] = useState<Row | null>(null);
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const filtered = trades.filter((t) => (!symbol || t.symbol === symbol) && (side === 'all' || t.side === side));
  const sells = trades.filter((t) => t.side === 'SELL' && t.pnl !== null);
  const wins = sells.filter((t) => (t.pnl as number) > 0).length;

  if (trades.length === 0) {
    return (
      <EmptyState icon={<Zap />} title="Aucun trade pour l'instant">
        Le bot attend que sa stratégie lui dise d'acheter. Chaque achat et chaque vente apparaîtra ici, avec la raison de la décision.
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={side}
          onChange={setSide}
          items={[
            { id: 'all', label: 'Tous' },
            { id: 'BUY', label: 'Achats' },
            { id: 'SELL', label: 'Ventes' },
          ]}
        />
        {symbols.length > 1 && (
          <select className={selectClass} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Filtrer par action">
            <option value="">Toutes les actions</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <span className="w-full text-xs text-ink-3 sm:ml-auto sm:w-auto">
          {filtered.length} ordre{filtered.length > 1 ? 's' : ''}
          {sells.length > 0 && (
            <>
              {' '}
              · ventes : <span className="text-up">{wins} gagnante{wins > 1 ? 's' : ''}</span>,{' '}
              <span className="text-down">
                {sells.length - wins} perdante{sells.length - wins > 1 ? 's' : ''}
              </span>
            </>
          )}
        </span>
      </div>

      <ul className="space-y-2.5">
        {filtered.slice(0, limit).map((t, i) => (
          <li key={t.id ?? `${t.time}-${t.symbol}-${i}`}>
            <TradeItem trade={t} currency={currency} color={colorOf?.(t.symbol)} onOpen={() => setSelected(t)} />
          </li>
        ))}
      </ul>
      {filtered.length > limit && (
        <button type="button" onClick={() => setLimit(limit + pageSize * 2)} className="mt-3 h-9 w-full rounded-lg border border-line text-sm font-medium text-ink-2 hover:bg-raised">
          Afficher plus ({filtered.length - limit} restants)
        </button>
      )}

      <Sheet open={!!selected} onClose={() => setSelected(null)} resetKey={selected} title={selected ? `${selected.side === 'BUY' ? 'Achat' : 'Vente'} de ${selected.symbol}` : ''}>
        {selected && <TradeDetail trade={selected} trades={trades} currency={currency} context={context} onOpen={setSelected} />}
      </Sheet>
    </div>
  );
}

function SideIcon({ buy, className }: { buy: boolean; className?: string }) {
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-xl', buy ? 'bg-up/12 text-up' : 'bg-down/12 text-down', className)} aria-hidden>
      {buy ? <ArrowUpRight /> : <ArrowDownRight />}
    </span>
  );
}

function TradeItem({ trade: t, currency, color, onOpen }: { trade: Row; currency: string; color?: string; onOpen: () => void }) {
  const buy = t.side === 'BUY';
  const trig = TRIGGERS[t.trigger];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full rounded-xl border border-line bg-page/40 p-3.5 text-left transition-colors hover:border-line-strong hover:bg-raised/40 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="flex items-start gap-3">
        <SideIcon buy={buy} className="size-9 [&_svg]:size-5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
              {color && <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
              <span className="truncate">
                {buy ? 'Achat' : 'Vente'} · {t.symbol}
              </span>
            </span>
            <span className="num shrink-0 text-sm text-ink-2">{fmtMoney(t.amount, currency)}</span>
          </div>
          <div className="num mt-0.5 text-xs text-ink-3">
            {fmtDay(t.time)} à {fmtTime(t.time)}
          </div>
          {t.pnl !== null && (
            <div
              className={cx(
                'num mt-1.5 inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold',
                t.pnl > 0 ? 'bg-up/12 text-up' : t.pnl < 0 ? 'bg-down/12 text-down' : 'bg-raised text-ink-2',
              )}
            >
              {t.pnl > 0 ? 'Gain' : t.pnl < 0 ? 'Perte' : 'Résultat'} : {fmtSignedMoney(t.pnl, currency)} ({fmtPct(t.pnlPct)})
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-raised/70 px-3 py-2.5">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-ink">Pourquoi ?</span>
          <Badge tone={trig.tone}>
            <trig.icon aria-hidden /> {trig.chip}
          </Badge>
        </div>
        <p className="line-clamp-3 text-[13px] leading-relaxed text-ink-2">{t.reason}</p>
      </div>
      <div className="mt-2 flex items-center justify-end gap-0.5 text-xs font-medium text-accent-text">
        Voir toute l'explication <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function TradeDetail({ trade: t, trades, currency, context, onOpen }: {
  trade: Row;
  trades: Row[];
  currency: string;
  context: TradeContext;
  onOpen: (t: Row) => void;
}) {
  const buy = t.side === 'BUY';
  const trig = TRIGGERS[t.trigger];
  const name = context.names?.[t.symbol];
  const entry = buy ? undefined : entryOf(t, trades);
  const exit = buy ? exitOf(t, trades) : undefined;
  const { strategy, stopLossPct, takeProfitPct } = context;
  const won = (t.pnl ?? 0) > 0;

  return (
    <div className="text-sm">
      {/* Résumé de l'ordre */}
      <div className="flex items-start gap-3">
        <SideIcon buy={buy} className="size-11 [&_svg]:size-6" />
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-snug text-ink">
            Le bot a {buy ? 'acheté' : 'vendu'} {fmtQty(t.qty)} {t.symbol} à {fmtPrice(t.price)} {t.currency || currency}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            {name ? `${name} · ` : ''}le {fmtDay(t.time)} à {fmtTime(t.time)}
          </p>
        </div>
      </div>
      <dl className="num mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-page/60 px-3 py-2.5">
          <dt className="text-xs text-ink-3">{buy ? 'Montant payé' : 'Montant reçu'}</dt>
          <dd className="mt-0.5 font-semibold text-ink">{fmtMoney(t.amount, currency)}</dd>
        </div>
        <div className="rounded-xl bg-page/60 px-3 py-2.5">
          <dt className="text-xs text-ink-3">dont frais</dt>
          <dd className="mt-0.5 font-semibold text-ink">{fmtMoney(t.fees, currency)}</dd>
        </div>
      </dl>
      <Receipt trade={t} currency={currency} />

      {/* La raison */}
      <Section title={buy ? 'Pourquoi le bot a acheté' : 'Pourquoi le bot a vendu'}>
        <div className="rounded-xl border border-accent/25 bg-accent/[0.07] p-3.5">
          <Badge tone={trig.tone} className="mb-2">
            <trig.icon aria-hidden /> {trig.long}
          </Badge>
          <p className="text-[15px] leading-relaxed text-ink">{t.reason}</p>
        </div>
      </Section>

      {/* Le résultat (vente) */}
      {!buy && t.pnl !== null && (
        <Section title="Résultat de ce trade">
          <div className={cx('rounded-xl border p-3.5', won ? 'border-up/30 bg-up/[0.07]' : 'border-down/30 bg-down/[0.07]')}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={cx('font-semibold', won ? 'text-up' : 'text-down')}>{won ? 'Trade gagnant' : 'Trade perdant'}</span>
              <span className={cx('num text-lg font-semibold', pnlClass(t.pnl))}>
                {fmtSignedMoney(t.pnl, currency)} <span className="text-sm">({fmtPct(t.pnlPct)})</span>
              </span>
            </div>
            <p className="mt-1 leading-relaxed text-ink-2">
              {won
                ? "Le bot a revendu plus cher qu'il n'avait acheté, frais compris."
                : "Le bot a revendu moins cher qu'il n'avait acheté (frais compris). Ça arrive : aucune stratégie ne gagne à tous les coups, l'important est de gagner plus souvent ou plus gros qu'on ne perd."}
            </p>
            {entry && (
              <ol className="num mt-3 space-y-2 border-t border-line pt-3 text-xs">
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-3">
                    Acheté le {fmtDateTime(entry.time)} à {fmtPrice(entry.price)} {entry.currency || ''}
                  </span>
                  <span className="text-ink-2">−{fmtMoney(entry.amount, currency)}</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-3">
                    Vendu le {fmtDateTime(t.time)} à {fmtPrice(t.price)} {t.currency || ''}
                  </span>
                  <span className="text-ink-2">+{fmtMoney(t.amount, currency)}</span>
                </li>
                <li className="flex items-center justify-between gap-3 text-ink-3">
                  <span>Action gardée pendant</span>
                  <span className="text-ink-2">{fmtDuration(t.time - entry.time)}</span>
                </li>
              </ol>
            )}
          </div>
          {entry && (
            <button type="button" onClick={() => onOpen(entry)} className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-accent-text hover:underline">
              Pourquoi le bot avait acheté <ChevronRight className="size-3.5" aria-hidden />
            </button>
          )}
        </Section>
      )}

      {/* La suite (achat) */}
      {buy && (
        <Section title="Et ensuite ?">
          {exit ? (
            <div className="rounded-xl bg-page/60 p-3.5 leading-relaxed text-ink-2">
              Le bot a revendu ces {t.symbol} le {fmtDateTime(exit.time)}, avec un résultat de{' '}
              <span className={cx('num font-semibold', pnlClass(exit.pnl))}>{fmtSignedMoney(exit.pnl, currency)}</span>.
              <button type="button" onClick={() => onOpen(exit)} className="mt-1 flex items-center gap-0.5 text-xs font-medium text-accent-text hover:underline">
                Voir pourquoi il a vendu <ChevronRight className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-page/60 p-3.5 leading-relaxed text-ink-2">
              <p>Le bot garde ces actions pour l'instant. Il les revendra :</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {strategy && <li>quand sa stratégie le décidera : {lowerFirst(strategy.rules.sell)}</li>}
                {!!stopLossPct && <li>automatiquement si le cours baisse de {stopLossPct} % sous le prix d'achat (stop-loss, pour limiter la perte) ;</li>}
                {!!takeProfitPct && <li>automatiquement si le cours monte de {takeProfitPct} % au-dessus du prix d'achat (objectif de gain).</li>}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* La règle de la stratégie */}
      {strategy && (
        <Section title={`La règle de la stratégie « ${strategy.short} »`}>
          <div className="space-y-2 rounded-xl bg-page/60 p-3.5 leading-relaxed">
            <p className="flex gap-2 text-ink-2">
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-up" aria-hidden />
              <span>
                <span className="font-semibold text-ink">Achète quand : </span>
                {lowerFirst(strategy.rules.buy)}
              </span>
            </p>
            <p className="flex gap-2 text-ink-2">
              <ArrowDownRight className="mt-0.5 size-4 shrink-0 text-down" aria-hidden />
              <span>
                <span className="font-semibold text-ink">Vend quand : </span>
                {lowerFirst(strategy.rules.sell)}
              </span>
            </p>
            <p className="border-t border-line pt-2 text-xs text-ink-3">{strategy.description}</p>
          </div>
        </Section>
      )}
    </div>
  );
}

/** Le décompte de l'ordre, comme sur un avis d'exécution de banque : valeur des actions, change, chaque frais, total. */
function Receipt({ trade: t, currency }: { trade: Row; currency: string }) {
  const buy = t.side === 'BUY';
  const quoteCur = t.currency || currency;
  const fx = t.fxRate || 1;
  const gross = buy ? t.amount - t.fees : t.amount + t.fees;
  const lines = t.costs ?? (t.fees > 0 ? [{ label: 'Frais de courtage', amount: t.fees, detail: '' }] : []);
  return (
    <details className="group mt-2 rounded-xl bg-page/60 px-3 py-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-accent-text [&::-webkit-details-marker]:hidden">
        Voir le détail des frais{quoteCur !== currency ? ' et du change' : ''}
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <ul className="num mt-2.5 space-y-1.5 text-xs">
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-ink-3">
            {fmtQty(t.qty)} × {fmtPrice(t.price)} {quoteCur}
            {quoteCur !== currency && (
              <>
                {' '}
                = {fmtMoney(t.qty * t.price, quoteCur)}, au taux de 1 {quoteCur} = {fmtNum(fx, 4)} {currency}
              </>
            )}
          </span>
          <span className="shrink-0 text-ink">{fmtMoney(gross, currency)}</span>
        </li>
        {lines.map((l) => (
          <li key={l.label} className="flex items-baseline justify-between gap-3">
            <span className="text-ink-3">
              {l.label}
              {l.detail && <span className="block text-[11px] text-ink-3/80">{nbsp(l.detail)}</span>}
            </span>
            <span className="shrink-0 text-ink-2">
              {buy ? '+' : '−'} {fmtMoney(l.amount, currency)}
            </span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5 font-semibold text-ink">
          <span>{buy ? 'Total payé' : 'Total reçu'}</span>
          <span className="shrink-0">{fmtMoney(t.amount, currency)}</span>
        </li>
      </ul>
      {gross > 0 && (
        <p className="mt-2 text-[11px] text-ink-3">
          Les frais représentent {fmtPct((t.fees / gross) * 100, 2, false)} du montant de l'ordre.
        </p>
      )}
    </details>
  );
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
