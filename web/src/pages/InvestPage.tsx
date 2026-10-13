// Nouveau placement, pour quelqu'un qui n'y connaît rien : un questionnaire (une question par écran),
// puis le bot propose un profil, choisit lui-même ses actions et montre ce que ça aurait donné dans le passé.

import { ArrowLeft, Check, Info, RotateCcw, Search, ShieldCheck, Sparkles, Star, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  assetInfo,
  BROKER_ANSWERS,
  computeProfile,
  configFromProfile,
  PROFILES,
  QUESTIONS,
  type Answers,
  type AssetSuggestion,
  type ProfileSimulation,
  type Question,
} from '../../../shared/profile.ts';
import type { SymbolSearchResult } from '../../../shared/types.ts';
import { useAppData } from '../App.tsx';
import { PerformanceChart } from '../components/charts.tsx';
import { AgitationChip, LEVEL_COLORS, RiskGauge } from '../components/profile.tsx';
import { Button, Card, cx, ErrorBox, inputClass } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDate, fmtMoney, fmtNum, fmtPct, nbsp, pnlClass } from '../lib/format.ts';

type Phase = 'intro' | 'question' | 'favorites' | 'money' | 'result';

interface Draft {
  phase: Phase;
  qIndex: number;
  answers: Answers;
  favorites: string[];
  capital: number;
  currency: string;
  broker: string;
}

const DEFAULT_DRAFT: Draft = { phase: 'intro', qIndex: 0, answers: {}, favorites: [], capital: 10_000, currency: 'CHF', broker: 'unknown' };
const DRAFT_KEY = 'tradebot.questionnaire';
const TOTAL_STEPS = QUESTIONS.length + 2;

/** Les réponses sont gardées pendant la visite : un rechargement de la page ne fait pas tout recommencer. */
function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...DEFAULT_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) } : null;
  } catch {
    return null;
  }
}

function saveDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Stockage indisponible (navigation privée) : tant pis, rien de grave.
  }
}

export function InvestPage() {
  const [draft, setDraft] = useState<Draft>(() => loadDraft() ?? DEFAULT_DRAFT);
  useEffect(() => saveDraft(draft), [draft]);
  useEffect(() => window.scrollTo({ top: 0 }), [draft.phase, draft.qIndex]);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const restart = () => setDraft({ ...DEFAULT_DRAFT, phase: 'question' });

  if (draft.phase === 'intro') return <Intro onStart={() => update({ phase: 'question', qIndex: 0 })} />;
  if (draft.phase === 'question') {
    const q = QUESTIONS[draft.qIndex];
    return (
      <QuestionStep
        key={q.id}
        question={q}
        step={draft.qIndex + 1}
        value={draft.answers[q.id]}
        onBack={() => (draft.qIndex === 0 ? update({ phase: 'intro' }) : update({ qIndex: draft.qIndex - 1 }))}
        onAnswer={(id) => setDraft((d) => ({ ...d, answers: { ...d.answers, [q.id]: id } }))}
        onNext={() => (draft.qIndex + 1 < QUESTIONS.length ? update({ qIndex: draft.qIndex + 1 }) : update({ phase: 'favorites' }))}
      />
    );
  }
  if (draft.phase === 'favorites')
    return (
      <FavoritesStep
        value={draft.favorites}
        onChange={(favorites) => update({ favorites })}
        onBack={() => update({ phase: 'question', qIndex: QUESTIONS.length - 1 })}
        onNext={() => update({ phase: 'money' })}
      />
    );
  if (draft.phase === 'money') return <MoneyStep draft={draft} update={update} onBack={() => update({ phase: 'favorites' })} onNext={() => update({ phase: 'result' })} />;
  return <Result draft={draft} onRestart={restart} onDone={() => saveDraft(null)} />;
}

// ---------------------------------------------------------------------------
// Les écrans du questionnaire
// ---------------------------------------------------------------------------

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto max-w-2xl animate-fade-up space-y-5">
      <section className="rounded-3xl border border-line bg-[radial-gradient(120%_120%_at_0%_0%,rgba(57,135,229,0.18),transparent_55%)] bg-surface p-6 sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-accent/15 text-accent-text [&_svg]:size-6">
          <Sparkles aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">Placer votre argent, sans rien y connaître</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Répondez à {QUESTIONS.length + 2} questions simples sur vous et sur ce que vous attendez. Le bot en déduit votre <b className="font-semibold text-ink">profil
          d'investisseur</b>, choisit lui-même les actions qui vous correspondent, puis s'occupe de tout : les acheter, les surveiller et protéger votre argent.
        </p>
        <ul className="mt-5 space-y-2.5 text-sm text-ink-2">
          {[
            'Environ 3 minutes. Il n’y a pas de bonne ou de mauvaise réponse.',
            "Avant de lancer quoi que ce soit, vous verrez ce que le bot aurait fait l'année passée.",
            "C'est de l'argent fictif : rien n'est débité, mais les cours de la bourse sont réels.",
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-up" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
        <Button variant="primary" className="mt-6 h-12 w-full text-base sm:w-auto sm:px-8" onClick={onStart}>
          Commencer le questionnaire
        </Button>
      </section>
    </div>
  );
}

function Progress({ step, section, onBack }: { step: number; section: string; onBack: () => void }) {
  return (
    <div className="mb-5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="-ml-2 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-raised hover:text-ink [&_svg]:size-4">
          <ArrowLeft aria-hidden /> Retour
        </button>
        <span className="text-xs text-ink-3">
          {step} sur {TOTAL_STEPS}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL_STEPS} aria-valuenow={step}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
      </div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-accent-text">{section}</div>
    </div>
  );
}

function Why({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex gap-2 text-sm leading-relaxed text-ink-3">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function OptionButton({ selected, onClick, label, detail, tone }: { selected: boolean; onClick: () => void; label: string; detail?: string; tone?: 'right' | 'wrong' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        tone === 'right' ? 'border-up/60 bg-up/10' : tone === 'wrong' ? 'border-warn/60 bg-warn/10' : selected ? 'border-accent/70 bg-accent/12' : 'border-line bg-surface hover:border-line-strong hover:bg-raised/60',
      )}
    >
      <span
        className={cx(
          'flex size-5 shrink-0 items-center justify-center rounded-full border-2 [&_svg]:size-3',
          selected ? 'border-accent bg-accent text-white' : 'border-line-strong',
        )}
        aria-hidden
      >
        {selected && <Check strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium leading-snug text-ink">{nbsp(label)}</span>
        {detail && <span className="mt-0.5 block text-sm text-ink-3">{nbsp(detail)}</span>}
      </span>
    </button>
  );
}

function QuestionStep({ question: q, step, value, onBack, onAnswer, onNext }: {
  question: Question;
  step: number;
  value: string | undefined;
  onBack: () => void;
  onAnswer: (id: string) => void;
  onNext: () => void;
}) {
  // Pour les questions de connaissances, on montre la bonne réponse avant de continuer.
  const [revealed, setRevealed] = useState(!!q.quiz && !!value);
  const choose = (id: string) => {
    onAnswer(id);
    if (q.quiz) setRevealed(true);
    else setTimeout(onNext, 220);
  };
  const correct = q.options.find((o) => o.correct);
  const gotIt = !!value && value === correct?.id;

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <Progress step={step} section={q.section} onBack={onBack} />
      <h1 className="text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl">{nbsp(q.title)}</h1>
      <Why>{nbsp(q.why)}</Why>
      <div className="mt-5 space-y-2.5">
        {q.options.map((o) => (
          <OptionButton
            key={o.id}
            selected={value === o.id}
            onClick={() => (revealed ? undefined : choose(o.id))}
            label={o.label}
            detail={o.detail}
            tone={revealed ? (o.correct ? 'right' : value === o.id ? 'wrong' : undefined) : undefined}
          />
        ))}
      </div>
      {revealed && q.quiz && (
        <div className={cx('mt-4 rounded-2xl border p-4 text-sm leading-relaxed', gotIt ? 'border-up/40 bg-up/10' : 'border-warn/40 bg-warn/10')}>
          <div className={cx('font-semibold', gotIt ? 'text-up' : 'text-warn')}>{gotIt ? 'Bonne réponse !' : 'Pas tout à fait.'}</div>
          <p className="mt-1 text-ink-2">{nbsp(q.quiz.explanation)}</p>
        </div>
      )}
      {(revealed || (!q.quiz && value)) && (
        <Button variant="primary" className="mt-5 h-12 w-full text-base" onClick={onNext}>
          Continuer
        </Button>
      )}
    </div>
  );
}

const POPULAR = ['AAPL', 'NESN.SW', 'TSLA', 'LOGN.SW', 'NVDA', 'MC.PA', 'SCMN.SW', 'KO', 'MSFT', 'NOVN.SW', 'NFLX', 'CFR.SW'];

function FavoritesStep({ value, onChange, onBack, onNext }: { value: string[]; onChange: (v: string[]) => void; onBack: () => void; onNext: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const full = value.length >= 3;
  const toggle = (symbol: string, name?: string) => {
    if (value.includes(symbol)) onChange(value.filter((s) => s !== symbol));
    else if (!full) {
      onChange([...value, symbol]);
      if (name) setNames((n) => ({ ...n, [symbol]: name }));
    }
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setResults([]);
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .search(q)
        .then((r) => !cancelled && setResults(r.filter((x) => x.type !== 'CRYPTOCURRENCY').slice(0, 6)))
        .catch(() => !cancelled && setResults([]));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const label = (s: string) => assetInfo(s)?.name ?? names[s] ?? s;

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <Progress step={QUESTIONS.length + 1} section="Vos préférences" onBack={onBack} />
      <h1 className="text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl">Y a-t-il des entreprises que vous aimez bien&nbsp;?</h1>
      <Why>Facultatif. Le bot les ajoutera à ses placements, en plus de ceux qu'il choisit (3 au maximum). Vous pouvez chercher n'importe quelle action.</Why>

      <div className="mt-5 flex flex-wrap gap-2">
        {POPULAR.map((s) => {
          const on = value.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              aria-pressed={on}
              disabled={!on && full}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors disabled:opacity-40 [&_svg]:size-3.5',
                on ? 'border-accent/70 bg-accent/15 text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
              )}
            >
              {on && <Check aria-hidden />}
              {label(s)}
            </button>
          );
        })}
      </div>

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          className={cx(inputClass, 'h-11 pl-9')}
          placeholder="Chercher (ex. Swatch, Ferrari)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={full}
        />
      </div>
      {results.length > 0 && !full && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                onClick={() => {
                  toggle(r.symbol, r.name);
                  setQuery('');
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-raised"
              >
                <span className="min-w-0 truncate text-ink">{r.name}</span>
                <span className="shrink-0 text-xs text-ink-3">
                  {r.symbol} · {r.exchange}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-3.5">
          <div className="mb-2 text-xs font-medium text-ink-3">Vos choix ({value.length}/3)</div>
          <div className="flex flex-wrap gap-2">
            {value.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 py-1 pr-1 pl-3 text-sm text-ink">
                <Star className="size-3.5 text-warn" aria-hidden />
                {label(s)}
                <button type="button" onClick={() => toggle(s)} className="rounded-full p-1 text-ink-3 hover:bg-raised hover:text-ink" aria-label={`Retirer ${label(s)}`}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <Button variant="primary" className="mt-6 h-12 w-full text-base" onClick={onNext}>
        {value.length ? 'Continuer' : 'Passer : le bot choisit tout'}
      </Button>
    </div>
  );
}

function MoneyStep({ draft, update, onBack, onNext }: { draft: Draft; update: (p: Partial<Draft>) => void; onBack: () => void; onNext: () => void }) {
  const { config } = useAppData();
  const valid = Number.isFinite(draft.capital) && draft.capital >= 100;
  return (
    <div className="mx-auto max-w-2xl animate-fade-up space-y-6">
      <div>
        <Progress step={TOTAL_STEPS} section="Votre placement" onBack={onBack} />
        <h1 className="text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl">Combien voulez-vous placer&nbsp;?</h1>
        <Why>C'est de l'argent fictif : choisissez un montant réaliste pour vous, pour que les frais et les résultats aient du sens.</Why>
        <div className="relative mt-4">
          <input
            type="number"
            inputMode="decimal"
            className={cx(inputClass, 'num h-12 pr-14 text-lg')}
            value={Number.isFinite(draft.capital) ? draft.capital : ''}
            min={100}
            step={100}
            onChange={(e) => update({ capital: e.target.value === '' ? NaN : Number(e.target.value) })}
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-ink-3">{draft.currency}</span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {[1_000, 5_000, 10_000, 50_000].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => update({ capital: n })}
              className={cx('num rounded-full border px-3.5 py-1.5 text-sm', draft.capital === n ? 'border-accent/70 bg-accent/15 text-ink' : 'border-line text-ink-2 hover:bg-raised')}
            >
              {fmtNum(n, 0)}
            </button>
          ))}
        </div>
        {!valid && <p className="mt-2 text-sm text-warn">Au moins 100.</p>}
      </div>

      <div>
        <h2 className="text-base font-semibold text-ink">Dans quelle monnaie est votre argent&nbsp;?</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(config.accountCurrencies ?? ['CHF', 'EUR', 'USD']).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => update({ currency: c })}
              className={cx('rounded-xl border px-3 py-2.5 text-sm font-semibold', draft.currency === c ? 'border-accent/70 bg-accent/12 text-ink' : 'border-line bg-surface text-ink-2')}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold text-ink">Avec quelle banque ou appli investiriez-vous&nbsp;?</h2>
        <p className="mt-1 text-sm text-ink-3">Le bot paiera les vrais frais de cette banque à chaque achat et chaque vente.</p>
        <div className="mt-3 space-y-2">
          {BROKER_ANSWERS.map((b) => (
            <OptionButton key={b.id} selected={draft.broker === b.id} onClick={() => update({ broker: b.id })} label={b.label} detail={b.detail} />
          ))}
        </div>
      </div>

      <Button variant="primary" className="h-12 w-full text-base" disabled={!valid} onClick={onNext}>
        Voir mon profil et mon placement
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Le résultat : profil, placements choisis, simulation du passé, lancement
// ---------------------------------------------------------------------------

/** Durée de la simulation honnête : le bot est « lancé » il y a 2 ans, avec ce qu'il pouvait savoir à ce moment-là. */
const SIM_YEARS = 2;

function Result({ draft, onRestart, onDone }: { draft: Draft; onRestart: () => void; onDone: () => void }) {
  const { config } = useAppData();
  const navigate = useNavigate();
  const result = useMemo(() => computeProfile(draft.answers), [draft.answers]);
  const profile = PROFILES[result.level];
  const [assets, setAssets] = useState<AssetSuggestion | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [sim, setSim] = useState<ProfileSimulation | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [name, setName] = useState(`Mon placement ${profile.name.toLowerCase()}`);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const crypto = draft.answers.crypto === 'yes';
  const region = draft.answers.region ?? 'any';
  const favoritesKey = draft.favorites.join(',');

  useEffect(() => {
    let cancelled = false;
    setAssets(null);
    setAssetsError(null);
    api
      .profileAssets({ level: result.level, region, crypto, favorites: favoritesKey ? favoritesKey.split(',') : [] })
      .then((r) => !cancelled && setAssets(r))
      .catch((err) => !cancelled && setAssetsError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [result.level, region, crypto, favoritesKey]);

  const picked = (assets?.picked ?? []).filter((p) => !removed.includes(p.symbol));
  const brokerName = config.brokers?.find((b) => b.id === (draft.broker === 'unknown' ? 'yuh' : draft.broker))?.name ?? 'Yuh';
  const botConfig = useMemo(
    () =>
      configFromProfile({
        result,
        answers: { ...draft.answers, favorites: draft.favorites.join(','), capital: String(draft.capital), currency: draft.currency, broker: draft.broker },
        symbols: picked.map((p) => p.symbol),
        volatility: Object.fromEntries(picked.map((p) => [p.symbol, Math.round(p.volatility * 10) / 10])),
        capital: draft.capital,
        currency: draft.currency,
        broker: draft.broker,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, draft, picked.map((p) => p.symbol).join(',')],
  );
  // Simulation honnête : le bot se place il y a 2 ans et choisit ses placements avec les seuls cours connus à cette date.
  // Elle est relancée si la personne retire un placement (il est alors exclu du choix d'il y a 2 ans aussi).
  const removedKey = removed.join(',');
  useEffect(() => {
    if (!assets) return;
    let cancelled = false;
    setSimLoading(true);
    setSimError(null);
    const t = setTimeout(() => {
      api
        .simulateProfile({
          level: result.level,
          maxLossPct: result.maxLossPct,
          region,
          crypto,
          favorites: favoritesKey ? favoritesKey.split(',') : [],
          exclude: removedKey ? removedKey.split(',') : [],
          years: SIM_YEARS,
          capital: draft.capital,
          currency: draft.currency,
          broker: draft.broker,
        })
        .then((r) => !cancelled && setSim(r))
        .catch((err) => !cancelled && setSimError(err instanceof Error ? err.message : String(err)))
        .finally(() => !cancelled && setSimLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [assets, result.level, result.maxLossPct, region, crypto, favoritesKey, removedKey, draft.capital, draft.currency, draft.broker]);

  const launch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const detail = await api.createBot({ ...botConfig, name: name.trim() || `Mon placement ${profile.name.toLowerCase()}` });
      onDone();
      navigate(`/bots/${detail.bot.id}`);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  };

  const cur = draft.currency;
  const floor = draft.capital * (1 - result.maxLossPct / 100);

  return (
    <div className="mx-auto max-w-3xl animate-fade-up space-y-5">
      {/* 1. Le profil */}
      <section className="rounded-3xl border border-line bg-surface p-5 sm:p-7">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Votre profil d'investisseur</div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight" style={{ color: LEVEL_COLORS[result.level] }}>
          {profile.name}
        </h1>
        <p className="mt-1 text-[15px] text-ink-2">{profile.tagline}</p>
        <RiskGauge level={result.level} showLabels className="mt-4 max-w-sm" />
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          Une année normale, un placement comme le vôtre peut évoluer entre environ{' '}
          <b className="font-semibold text-down">{nbsp(`${profile.typicalYear.worst} %`)}</b> et <b className="font-semibold text-up">{nbsp(`+${profile.typicalYear.best} %`)}</b>. C'est un ordre de grandeur, pas une promesse.
        </p>
        {result.limitedBy.length > 0 && (
          <div className="mt-4 rounded-2xl bg-page/60 p-4 text-sm leading-relaxed text-ink-2">
            <div className="font-semibold text-ink">Pourquoi pas plus de risque&nbsp;?</div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              {result.limitedBy.map((t) => (
                <li key={t}>{nbsp(t.charAt(0).toUpperCase() + t.slice(1))}.</li>
              ))}
            </ul>
          </div>
        )}
        {result.warnings.map((w) => (
          <div key={w} className="mt-3 flex gap-2.5 rounded-2xl border border-warn/30 bg-warn/10 p-4 text-sm leading-relaxed text-ink-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <span>{nbsp(w)}</span>
          </div>
        ))}
      </section>

      {/* 2. Ce que le bot va faire */}
      <Card title="Ce que le bot va faire pour vous">
        <ol className="space-y-3 text-sm leading-relaxed text-ink-2">
          <Step n={1}>{nbsp(profile.plan)}</Step>
          <Step n={2}>
            <b className="font-semibold text-ink">Comment il décide : </b>
            {nbsp(profile.howItDecides)}
          </Step>
          <Step n={3}>
            <b className="font-semibold text-ink">Sa protection : </b>
            si votre placement descend sous <b className="font-semibold text-ink">{fmtMoney(floor, cur, 0)}</b> (−{result.maxLossPct}&nbsp;%, la baisse que vous avez dit
            pouvoir supporter), il vend tout pour protéger le reste et se met en pause.
            {botConfig.stopLossPct > 0 && <> Il revend aussi une action qui baisse de {botConfig.stopLossPct}&nbsp;% après l'achat.</>}
          </Step>
          <Step n={4}>Il paie les vrais frais de {brokerName} (courtage, change, droit de timbre) à chaque achat et chaque vente.</Step>
        </ol>
      </Card>

      {/* 3. Les placements choisis */}
      <Card
        title="Les placements choisis par le bot"
        subtitle={
          assets
            ? `Il a mesuré les variations de prix de ${assets.analysed} placements sur l'année passée et gardé ceux qui correspondent à votre profil.`
            : "Le bot mesure les variations de prix des actions sur l'année passée…"
        }
      >
        {assetsError && <ErrorBox>Impossible d'analyser les actions : {assetsError}</ErrorBox>}
        {!assets && !assetsError && <AnalysisLoader />}
        {assets && (
          <ul className="space-y-2.5">
            {picked.map((p) => {
              const info = assetInfo(p.symbol);
              return (
                <li key={p.symbol} className="rounded-2xl border border-line bg-page/40 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-ink">{info?.name ?? p.name}</span>
                        <span className="text-xs text-ink-3">{p.symbol}</span>
                        {p.favorite && (
                          <span className="inline-flex items-center gap-1 text-xs text-warn">
                            <Star className="size-3" aria-hidden /> votre choix
                          </span>
                        )}
                      </div>
                      {info?.what && <p className="mt-0.5 text-sm text-ink-3">{info.what}</p>}
                    </div>
                    {picked.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setRemoved((r) => [...r, p.symbol])}
                        className="-m-1 shrink-0 rounded-lg p-1.5 text-ink-3 hover:bg-raised hover:text-ink"
                        aria-label={`Retirer ${info?.name ?? p.symbol}`}
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <AgitationChip volatility={p.volatility} />
                    <span className="text-xs text-ink-3">
                      sur un an : <span className={pnlClass(p.perf1y)}>{fmtPct(p.perf1y, 1)}</span>
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{p.why}</p>
                  {p.tooRisky && (
                    <p className="mt-1.5 flex gap-1.5 text-xs leading-relaxed text-warn">
                      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                      Plus agitée que ce que prévoit votre profil : le bot l'achète quand même, puisque vous l'avez choisie.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {assets && botConfig.symbols.length > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            À chaque achat, le bot investit au plus {botConfig.positionSizePct}&nbsp;% de votre argent dans un même placement
            {PROFILES[result.level].maxInvestedPct < 100 ? `, et garde au moins ${100 - PROFILES[result.level].maxInvestedPct} % de côté` : ''}.
          </p>
        )}
      </Card>

      {/* 4. Simulation du passé */}
      {assets && botConfig.symbols.length > 0 && (
        <Card
          title={`Et si vous l'aviez lancé il y a ${SIM_YEARS} ans ?`}
          subtitle="Le bot se met à la place d'il y a 2 ans : il ne connaît que les cours d'avant cette date, choisit ses placements, puis on regarde ce qui s'est vraiment passé ensuite, frais compris."
        >
          {simError && <ErrorBox>{simError}</ErrorBox>}
          {!sim && !simError && <AnalysisLoader text="Le bot se replace il y a 2 ans et rejoue ce qui s'est passé depuis…" />}
          {sim && (
            <Simulation sim={sim} capital={draft.capital} currency={cur} reservePct={100 - PROFILES[result.level].maxInvestedPct} loading={simLoading} />
          )}
        </Card>
      )}

      {/* 5. Lancer */}
      <section className="rounded-3xl border border-accent/30 bg-accent/[0.07] p-5 sm:p-7">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink [&_svg]:size-4">
          <ShieldCheck className="text-accent-text" aria-hidden /> Prêt à lancer votre placement&nbsp;?
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
          Le bot démarre tout de suite avec {fmtMoney(draft.capital, cur, 0)} d'argent fictif, sur les vrais cours de la bourse. Vous n'aurez plus rien à décider : vous
          pourrez juste suivre ce qu'il fait, et pourquoi.
        </p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Nom du placement</span>
          <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        {launchError && (
          <div className="mt-3">
            <ErrorBox>{launchError}</ErrorBox>
          </div>
        )}
        <Button variant="primary" className="mt-4 h-12 w-full text-base" disabled={launching || !assets || botConfig.symbols.length === 0} onClick={launch}>
          {launching ? 'Lancement…' : 'Lancer mon placement'}
        </Button>
        <button type="button" onClick={onRestart} className="mx-auto mt-3 flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink-2 [&_svg]:size-3.5">
          <RotateCcw aria-hidden /> Refaire le questionnaire
        </button>
      </section>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent-text">{n}</span>
      <span>{children}</span>
    </li>
  );
}

function AnalysisLoader({ text = "Le bot mesure l'agitation de chaque action sur l'année passée…" }: { text?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-page/60 p-4 text-sm text-ink-2">
      <span className="size-5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-hidden />
      {text}
    </div>
  );
}

function Simulation({ sim, capital, currency, reservePct, loading }: {
  sim: ProfileSimulation;
  capital: number;
  currency: string;
  reservePct: number;
  loading: boolean;
}) {
  const r = sim.result;
  const s = r.stats;
  const gain = s.finalEquity - capital;
  const trades = r.trades.length;
  const years = `${sim.years} an${sim.years > 1 ? 's' : ''}`;
  return (
    <div className={cx('space-y-4 transition-opacity', loading && 'opacity-60')}>
      <div className="rounded-2xl border border-line p-4">
        <p className="text-sm leading-relaxed text-ink-2">
          Le <b className="font-semibold text-ink">{fmtDate(sim.startTime)}</b>, avec les cours de l'année d'avant, le bot aurait choisi :
        </p>
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {sim.picked.map((p) => (
            <li key={p.symbol} className="inline-flex items-center gap-1.5 rounded-full bg-raised py-1 pr-1 pl-3 text-sm text-ink">
              {assetInfo(p.symbol)?.name ?? p.name}
              <AgitationChip volatility={p.volatility} compact />
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-xs leading-relaxed text-ink-3">
          Ce ne sont pas forcément les mêmes qu'aujourd'hui : à l'époque, le bot ne pouvait pas savoir quelles actions allaient monter.
        </p>
      </div>
      <div className="rounded-2xl bg-page/60 p-4">
        <p className="text-sm text-ink-2">
          Avec {fmtMoney(capital, currency, 0)} placés il y a {years}, vous auriez aujourd'hui
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="num text-3xl font-semibold tracking-tight text-ink">{fmtMoney(s.finalEquity, currency, 0)}</span>
          <span className={cx('num text-lg font-semibold', pnlClass(gain))}>
            {gain >= 0 ? '+' : '−'}
            {fmtMoney(Math.abs(gain), currency, 0)} ({fmtPct(s.totalReturnPct, 1)})
          </span>
        </div>
      </div>
      <ul className="space-y-2 text-sm leading-relaxed text-ink-2">
        <li>
          <b className="font-semibold text-ink">Au pire moment</b>, le placement avait baissé de{' '}
          <span className="num font-semibold text-down">{fmtNum(s.maxDrawdownPct, 1)}&nbsp;%</span> par rapport à son plus haut.
        </li>
        {reservePct > 0 && (
          <li>
            Le bot a gardé {reservePct}&nbsp;% de côté. S'il avait tout investi, le résultat aurait été{' '}
            <span className={cx('num font-semibold', pnlClass(s.benchmarkReturnPct))}>{fmtPct(s.benchmarkReturnPct, 1)}</span>, avec une pire baisse de{' '}
            {fmtNum(s.benchmarkMaxDrawdownPct, 1)}&nbsp;%.
          </li>
        )}
        <li>
          Le bot a fait {trades} achat{trades > 1 ? 's' : ''} et vente{trades > 1 ? 's' : ''}, et payé {fmtMoney(s.feesPaid, currency, 0)} de frais.
        </li>
        {r.protectionAt !== null && (
          <li className="flex gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <span>
              Le {fmtDate(r.protectionAt)}, la baisse a atteint votre limite : le bot a tout vendu pour protéger votre argent, puis s'est mis en pause.
            </span>
          </li>
        )}
      </ul>
      <PerformanceChart points={r.equity} initialCapital={capital} currency={currency} title="Valeur du placement simulé" ranges={[]} height={240} />
      <p className="text-xs leading-relaxed text-ink-3">
        Cette simulation n'utilise aucune information du futur : à chaque instant, le bot ne connaît que les cours passés, comme il le fera avec votre vrai
        placement. Elle montre ce qui se serait réellement passé, pas une promesse : les {years} à venir ne ressembleront pas forcément aux {years} passés.
      </p>
    </div>
  );
}
