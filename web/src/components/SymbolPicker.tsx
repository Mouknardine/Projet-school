// Sélection des actions suivies par le bot : recherche par nom + listes prêtes à l'emploi.

import { useEffect, useRef, useState } from 'react';
import type { SymbolSearchResult } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { cx, inputClass } from './ui.tsx';

export const PRESETS: { label: string; hint: string; symbols: string[] }[] = [
  { label: 'Tech US', hint: 'USD', symbols: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN'] },
  { label: 'Suisse (SMI)', hint: 'CHF', symbols: ['NESN.SW', 'NOVN.SW', 'ROG.SW', 'UBSG.SW', 'ZURN.SW'] },
  { label: 'Europe', hint: 'EUR', symbols: ['ASML.AS', 'MC.PA', 'SAP.DE', 'SIE.DE', 'AIR.PA'] },
  { label: 'ETF indices US', hint: 'USD', symbols: ['SPY', 'QQQ', 'DIA'] },
  { label: 'Crypto (24h/24)', hint: 'USD', symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'] },
];

export function SymbolPicker({ value, onChange }: { value: string[]; onChange: (symbols: string[]) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.search(q);
        if (!cancelled) {
          setResults(r);
          setSearchError(null);
        }
      } catch (err) {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const add = (symbol: string) => {
    const s = symbol.trim().toUpperCase();
    if (s && !value.includes(s) && value.length < 10) onChange([...value, s]);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {value.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-md bg-slate-800 py-1 pl-2.5 pr-1 text-sm font-medium text-slate-100 ring-1 ring-slate-700">
            {s}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== s))}
              className="rounded px-1 text-slate-400 hover:bg-slate-700 hover:text-white"
              aria-label={`Retirer ${s}`}
            >
              ×
            </button>
          </span>
        ))}
        {value.length === 0 && <span className="text-sm text-slate-500">Aucune action sélectionnée</span>}
      </div>

      <div ref={boxRef} className="relative">
        <input
          className={inputClass}
          placeholder="Rechercher une action (ex. Nestlé, Tesla, Logitech) ou taper un symbole puis Entrée"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const exact = results.find((r) => r.symbol === query.trim().toUpperCase());
              add(exact?.symbol ?? results[0]?.symbol ?? query);
            }
          }}
        />
        {open && query.trim().length >= 2 && (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
            {searching && <div className="px-3 py-2 text-sm text-slate-400">Recherche…</div>}
            {searchError && <div className="px-3 py-2 text-sm text-rose-300">{searchError}</div>}
            {!searching && !searchError && results.length === 0 && (
              <div className="px-3 py-2 text-sm text-slate-400">Aucun résultat. Appuyez sur Entrée pour ajouter « {query.trim().toUpperCase()} ».</div>
            )}
            {results.map((r) => (
              <button
                key={r.symbol}
                type="button"
                onClick={() => add(r.symbol)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-800"
              >
                <span>
                  <span className="font-semibold text-slate-100">{r.symbol}</span>
                  <span className="ml-2 text-slate-400">{r.name}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {r.exchange} · {r.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Listes rapides :</span>
        {PRESETS.map((p) => {
          const active = p.symbols.length === value.length && p.symbols.every((s) => value.includes(s));
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.symbols)}
              className={cx(
                'rounded-md px-2 py-1 text-xs ring-1 transition-colors',
                active ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40' : 'text-slate-300 ring-slate-700 hover:bg-slate-800',
              )}
            >
              {p.label} <span className="text-slate-500">{p.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
