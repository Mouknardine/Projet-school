// Historique des trades : chaque ordre passé par le bot, avec sa justification.

import { ArrowDownRight, ArrowUpRight, Hand, ShieldAlert, Target, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Trade, TradeTrigger } from '../../../shared/types.ts';
import { fmtDate, fmtMoney, fmtPrice, fmtQty, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { cx, Delta, EmptyState, Segmented } from './ui.tsx';

type Row = Omit<Trade, 'id' | 'botId'> & { id?: number };

const TRIGGERS: Record<TradeTrigger, { label: string; icon: typeof Zap }> = {
  signal: { label: 'Signal', icon: Zap },
  stop_loss: { label: 'Stop-loss', icon: ShieldAlert },
  take_profit: { label: 'Objectif', icon: Target },
  manual: { label: 'Manuel', icon: Hand },
};

const selectClass = 'h-[30px] rounded-lg border border-line bg-page px-2 text-xs text-ink-2 outline-none focus:border-accent';

export function TradesTable({ trades, currency, pageSize = 25, colorOf }: {
  trades: Row[];
  currency: string;
  pageSize?: number;
  colorOf?: (symbol: string) => string;
}) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<'all' | 'BUY' | 'SELL'>('all');
  const [limit, setLimit] = useState(pageSize);
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const filtered = trades.filter((t) => (!symbol || t.symbol === symbol) && (side === 'all' || t.side === side));
  const sells = trades.filter((t) => t.side === 'SELL' && t.pnl !== null);
  const wins = sells.filter((t) => (t.pnl as number) > 0).length;

  if (trades.length === 0) {
    return (
      <EmptyState icon={<Zap />} title="Aucun trade pour l'instant">
        Le bot attend un signal de sa stratégie. Chaque ordre apparaîtra ici avec la raison de la décision.
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
        <select className={selectClass} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Filtrer par action">
          <option value="">Toutes les actions</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-ink-3">
          {sells.length > 0 && (
            <>
              <span className="text-up">{wins} gagnante(s)</span> · <span className="text-down">{sells.length - wins} perdante(s)</span> ·{' '}
            </>
          )}
          {filtered.length} ordre(s)
        </span>
      </div>
      <div className="relative -mx-5 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-y border-line text-left text-xs text-ink-3">
              <th className="px-5 py-2.5 font-medium">Date</th>
              <th className="px-3 py-2.5 font-medium">Ordre</th>
              <th className="px-3 py-2.5 text-right font-medium">Quantité × prix</th>
              <th className="px-3 py-2.5 text-right font-medium">Montant</th>
              <th className="px-3 py-2.5 text-right font-medium">Résultat</th>
              <th className="px-5 py-2.5 font-medium">Raison de la décision</th>
            </tr>
          </thead>
          <tbody className="num">
            {filtered.slice(0, limit).map((t, i) => {
              const trig = TRIGGERS[t.trigger];
              const TrigIcon = trig.icon;
              const buy = t.side === 'BUY';
              return (
                <tr key={t.id ?? `${t.time}-${t.symbol}-${i}`} className="border-b border-line/70 align-top transition-colors last:border-0 hover:bg-raised/40">
                  <td className="whitespace-nowrap px-5 py-3 text-ink-2">
                    {fmtDate(t.time)}
                    <div className="text-xs text-ink-3">{new Date(t.time).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cx('flex size-7 items-center justify-center rounded-lg [&_svg]:size-4', buy ? 'bg-up/12 text-up' : 'bg-down/12 text-down')}
                        aria-hidden
                      >
                        {buy ? <ArrowUpRight /> : <ArrowDownRight />}
                      </span>
                      <div>
                        <div className="flex items-center gap-1.5 font-semibold text-ink">
                          {colorOf && <span className="size-1.5 rounded-full" style={{ background: colorOf(t.symbol) }} />}
                          {buy ? 'Achat' : 'Vente'} {t.symbol}
                        </div>
                        <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-3 [&_svg]:size-3">
                          <TrigIcon aria-hidden /> {trig.label}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-ink-2">
                    {fmtQty(t.qty)} × {fmtPrice(t.price)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <div className="text-ink">{fmtMoney(t.amount, currency)}</div>
                    <div className="text-xs text-ink-3">frais {fmtMoney(t.fees, currency)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {t.pnl === null ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <>
                        <div className={cx('font-medium', pnlClass(t.pnl))}>{fmtSignedMoney(t.pnl, currency)}</div>
                        <Delta value={t.pnlPct} className="mt-0.5" />
                      </>
                    )}
                  </td>
                  <td className="min-w-[240px] max-w-md px-5 py-3 text-xs leading-relaxed text-ink-2">{t.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <button type="button" onClick={() => setLimit(limit + pageSize * 2)} className="mt-3 text-xs font-medium text-accent-text hover:underline">
          Afficher plus ({filtered.length - limit} restants)
        </button>
      )}
    </div>
  );
}
