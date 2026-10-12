// Petits composants d'interface réutilisables.

import { ArrowDownRight, ArrowUpRight, CircleHelp, Minus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function Card({ id, title, subtitle, actions, children, className, bodyClassName }: {
  id?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={cx('min-w-0 scroll-mt-20 rounded-2xl border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('px-5 pb-5', !(title || actions) && 'pt-5', bodyClassName)}>{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ variant = 'secondary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-accent text-white hover:bg-[#4a94ea] font-semibold shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]',
    secondary: 'bg-raised text-ink hover:bg-line border border-line',
    danger: 'text-down hover:bg-down/10 border border-line',
    ghost: 'text-ink-2 hover:bg-raised hover:text-ink',
  };
  return (
    <button
      className={cx(
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

type Tone = 'up' | 'down' | 'warn' | 'accent' | 'neutral' | 'violet';

const TONES: Record<Tone, string> = {
  up: 'bg-up/12 text-up',
  down: 'bg-down/12 text-down',
  warn: 'bg-warn/12 text-warn',
  accent: 'bg-accent/15 text-accent-text',
  violet: 'bg-s7/15 text-[#b3abf2]',
  neutral: 'bg-raised text-ink-2',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3', TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Pastille de variation : flèche + valeur, verte si positive, rouge si négative (jamais la couleur seule). */
export function Delta({ value, suffix = ' %', digits = 2, className, size = 'sm' }: {
  value: number | null | undefined;
  suffix?: string;
  digits?: number;
  className?: string;
  size?: 'sm' | 'md';
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-ink-3">–</span>;
  const flat = Math.abs(value) < 0.005;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = flat ? 'neutral' : value > 0 ? 'up' : 'down';
  const formatted = new Intl.NumberFormat('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  return (
    <span
      className={cx(
        'num inline-flex items-center gap-0.5 whitespace-nowrap rounded-md font-semibold',
        size === 'sm' ? 'px-1.5 py-0.5 text-xs [&_svg]:size-3.5' : 'px-2 py-1 text-sm [&_svg]:size-4',
        TONES[tone],
        className,
      )}
    >
      <Icon aria-hidden />
      <span className="sr-only">{flat ? 'stable' : value > 0 ? 'hausse de' : 'baisse de'}</span>
      {formatted}
      {suffix}
    </span>
  );
}

export function LiveDot({ on, className }: { on: boolean | null; className?: string }) {
  return (
    <span className={cx('relative inline-flex size-2 shrink-0', className)} aria-hidden>
      {on && <span className="absolute inline-flex size-full animate-ping rounded-full bg-up opacity-50 motion-reduce:hidden" />}
      <span className={cx('relative inline-flex size-2 rounded-full', on ? 'bg-up' : 'bg-ink-3')} />
    </span>
  );
}

/**
 * Petit bouton « ? » qui déplie une explication sous le libellé.
 * Un clic (ou un toucher sur mobile) suffit : pas besoin de survoler, contrairement à une infobulle.
 */
export function HelpToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Masquer' : 'Afficher'} l'explication : ${label}`}
      className={cx(
        '-m-1.5 rounded-full p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-accent [&_svg]:size-3.5',
        open ? 'text-accent-text' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      <CircleHelp aria-hidden />
    </button>
  );
}

/** Tuile de chiffre clé : libellé, valeur, détail, et explication facultative dépliable. */
export function StatTile({ label, icon, value, sub, valueClassName, help }: {
  label: string;
  icon?: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  valueClassName?: string;
  /** Explication en langage simple, affichée en touchant le « ? ». */
  help?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3 [&>svg]:size-3.5">
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {help && <HelpToggle label={label} open={open} onToggle={() => setOpen(!open)} />}
      </div>
      <div className={cx('mt-1.5 truncate text-xl font-semibold tracking-tight text-ink', valueClassName)}>{value}</div>
      {sub && <div className="mt-1 line-clamp-2 text-xs leading-snug text-ink-3">{sub}</div>}
      {help && open && <p className="mt-2 rounded-lg bg-accent/10 px-2.5 py-2 text-xs leading-relaxed text-ink-2">{help}</p>}
    </div>
  );
}

/**
 * Fenêtre de détail : panneau qui glisse depuis le bas sur mobile, boîte centrée sur ordinateur.
 * Se ferme avec le bouton « Fermer », la touche Échap ou en touchant le fond.
 */
export function Sheet({ open, onClose, title, children, resetKey }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Quand cette valeur change (nouveau contenu), la fenêtre revient en haut. */
  resetKey?: unknown;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);
  // Gardé dans une référence : le tableau de bord se rafraîchit souvent, et l'effet ci-dessous
  // ne doit pas se relancer (ni redonner le focus au bouton) à chaque rafraîchissement.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="animate-fade-in absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div className="animate-sheet relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line-strong bg-surface shadow-2xl sm:max-w-xl sm:rounded-3xl">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold text-ink">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-raised px-3 text-sm font-medium text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent [&_svg]:size-4"
          >
            <X aria-hidden /> Fermer
          </button>
        </header>
        <div ref={bodyRef} className="overflow-y-auto overscroll-contain px-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-ink-3">
      <span className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      {label}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-down/30 bg-down/10 px-4 py-3 text-sm text-[#ffb3bd]">{children}</div>;
}

export function InfoBox({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm leading-relaxed text-ink-2">{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink placeholder-ink-3 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent';

/** Sélecteur segmenté (onglets compacts, périodes, symboles). */
export function Segmented<T extends string>({ value, onChange, items, size = 'sm' }: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: ReactNode }[];
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-page p-0.5" role="tablist">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={cx(
            'rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === it.id ? 'bg-raised text-ink shadow-sm ring-1 ring-line-strong' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Ancien nom conservé pour les pages qui l'utilisent. */
export const Tabs = Segmented;

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
      {icon && <div className="mb-3 rounded-xl bg-raised p-3 text-ink-3 [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-3">{children}</p>}
    </div>
  );
}
