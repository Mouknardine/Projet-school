// Petits composants d'interface réutilisables.

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function Card({ title, actions, children, className, bodyClassName }: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('min-w-0 rounded-xl border border-slate-800 bg-slate-900/60', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ variant = 'secondary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-semibold',
    secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700',
    danger: 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/30',
    ghost: 'text-slate-300 hover:bg-slate-800',
  };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

type Tone = 'green' | 'red' | 'amber' | 'sky' | 'slate' | 'violet';

export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const tones: Record<Tone, string> = {
    green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    red: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
    violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
    slate: 'bg-slate-700/40 text-slate-300 ring-slate-600/40',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ on }: { on: boolean | null }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {on && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={cx('relative inline-flex h-2 w-2 rounded-full', on ? 'bg-emerald-400' : 'bg-slate-500')} />
    </span>
  );
}

export function Kpi({ label, value, sub, valueClassName }: { label: string; value: ReactNode; sub?: ReactNode; valueClassName?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cx('num mt-1 text-xl font-semibold text-slate-50', valueClassName)}>{value}</div>
      {sub && <div className="num mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400" />
      {label}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{children}</div>;
}

export function InfoBox({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-slate-950/60 p-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onChange(it.id)}
          className={cx(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            value === it.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
