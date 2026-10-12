// Historique des trades : chaque ordre passé par le bot, avec sa justification.

import { useMemo, useState } from 'react';
import type { Trade, TradeTrigger } from '../../../shared/types.ts';
import { fmtDate, fmtMoney, fmtPct, fmtPrice, fmtQty, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { Badge, cx } from './ui.tsx';

type Row = Omit<Trade, 'id' | 'botId'> & { id?: number };

const TRIGGERS: Record<TradeTrigger, { label: string; tone: 'sky' | 'red' | 'green' | 'violet' }> = {
  signal: { label: 'Signal', tone: 'sky' },
  stop_loss: { label: 'Stop-loss', tone: 'red' },
  take_profit: { label: 'Take-profit', tone: 'green' },
  manual: { label: 'Manuel', tone: 'violet' },
};

export function TradesTable({ trades, currency, pageSize = 25 }: { trades: Row[]; currency: string; pageSize?: number }) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<'' | 'BUY' | 'SELL'>('');
  const [limit, setLimit] = useState(pageSize);
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const filtered = trades.filter((t) => (!symbol || t.symbol === symbol) && (!side || t.side === side));

  if (trades.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">Aucun trade pour l'instant. Le bot attend un signal de sa stratégie.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          <option value="">Toutes les actions</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs" value={side} onChange={(e) => setSide(e.target.value as '' | 'BUY' | 'SELL')}>
          <option value="">Achats et ventes</option>
          <option value="BUY">Achats</option>
          <option value="SELL">Ventes</option>
        </select>
        <span className="self-center text-xs text-slate-500">{filtered.length} trade(s)</span>
      </div>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-2 py-2 font-medium">Action</th>
              <th className="px-2 py-2 font-medium">Ordre</th>
              <th className="px-2 py-2 text-right font-medium">Quantité</th>
              <th className="px-2 py-2 text-right font-medium">Prix</th>
              <th className="px-2 py-2 text-right font-medium">Montant (frais)</th>
              <th className="px-2 py-2 text-right font-medium">Résultat</th>
              <th className="px-4 py-2 font-medium">Raison</th>
            </tr>
          </thead>
          <tbody className="num">
            {filtered.slice(0, limit).map((t, i) => (
              <tr key={t.id ?? `${t.time}-${t.symbol}-${i}`} className="border-b border-slate-800/60 align-top hover:bg-slate-800/30">
                <td className="whitespace-nowrap px-4 py-2 text-slate-300">
                  {fmtDate(t.time)}
                  <div className="text-xs text-slate-500">{new Date(t.time).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}</div>
                </td>
                <td className="px-2 py-2 font-semibold text-slate-100">{t.symbol}</td>
                <td className="px-2 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={t.side === 'BUY' ? 'green' : 'red'}>{t.side === 'BUY' ? 'ACHAT' : 'VENTE'}</Badge>
                    {t.trigger !== 'signal' && <Badge tone={TRIGGERS[t.trigger].tone}>{TRIGGERS[t.trigger].label}</Badge>}
                  </div>
                </td>
                <td className="px-2 py-2 text-right">{fmtQty(t.qty)}</td>
                <td className="px-2 py-2 text-right">{fmtPrice(t.price)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  {fmtMoney(t.amount, currency)}
                  <div className="text-xs text-slate-500">{fmtMoney(t.fees, currency)}</div>
                </td>
                <td className={cx('whitespace-nowrap px-2 py-2 text-right font-medium', pnlClass(t.pnl))}>
                  {t.pnl === null ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <>
                      {fmtSignedMoney(t.pnl, currency)}
                      <div className="text-xs font-normal">{fmtPct(t.pnlPct)}</div>
                    </>
                  )}
                </td>
                <td className="min-w-[220px] max-w-md px-4 py-2 text-xs leading-relaxed text-slate-400">{t.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <button type="button" onClick={() => setLimit(limit + pageSize * 2)} className="mt-3 text-xs text-emerald-400 hover:underline">
          Afficher plus ({filtered.length - limit} restants)
        </button>
      )}
    </div>
  );
}
