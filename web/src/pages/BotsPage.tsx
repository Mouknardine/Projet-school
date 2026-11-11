// Page d'accueil : le « poste de trading ». En haut, le résultat de tous les bots d'un coup d'œil ;
// dessous, une carte par bot (valeur, résultat, courbe, indicateurs de trading).

import { BookOpen, ChevronRight, ClipboardList, Plus, Radar, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { useAppData } from '../App.tsx';
import { COLORS, SERIES, Sparkline } from '../components/charts.tsx';
import { ProfileBadge } from '../components/profile.tsx';
import { Badge, cx, Delta, EmptyState, ErrorBox, LiveDot, Spinner } from '../components/ui.tsx';
import { assetInfo } from '../../../shared/profile.ts';
import type { BotListItem } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtSignedMoney } from '../lib/format.ts';
import { usePolling } from '../lib/usePolling.ts';

const STEPS = [
  { icon: ClipboardList, title: 'Vous répondez à quelques questions', text: 'Votre situation et le risque que vous acceptez. Environ 3 minutes.' },
  { icon: Radar, title: 'Le bot trade pour vous', text: 'Il choisit les valeurs, ouvre et ferme les positions avec un stop-loss et un objectif de gain, sur les vrais cours.' },
  { icon: Sparkles, title: 'Vous suivez chaque ordre', text: 'Chaque achat et chaque vente est expliqué en français, graphique à l’appui.' },
];

const tone = (n: number | null | undefined) => (n === null || n === undefined || Math.abs(n) < 0.005 ? 'flat' : n > 0 ? 'up' : 'down');
const TONE_TEXT = { up: 'text-up', down: 'text-down', flat: 'text-ink-2' } as const;
const TONE_GLOW = { up: 'glow-up', down: 'glow-down', flat: 'glow-flat' } as const;

/** Un chiffre clé : libellé discret, valeur nette. */
function Kpi({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0 bg-surface px-4 py-3.5 sm:px-5 sm:py-4', className)}>
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">{children}</div>
    </div>
  );
}

export function BotsPage() {
  const { strategies } = useAppData();
  const { data, error, loading } = usePolling(() => api.bots(), [], 15_000);
  const strategyName = (id: string) => strategies.find((s) => s.id === id)?.short ?? id;
  const running = data?.filter((b) => b.bot.status === 'running').length ?? 0;
  const totalTrades = data?.reduce((a, b) => a + b.summary.tradesCount, 0) ?? 0;
  const best = data && data.length ? [...data].sort((a, b) => b.summary.pnlPct - a.summary.pnlPct)[0] : null;

  // Le total n'a de sens que si tous les comptes sont dans la même monnaie.
  const currencies = new Set(data?.map((b) => b.bot.currency));
  const sameCurrency = currencies.size === 1;
  const cur = data?.[0]?.bot.currency ?? 'CHF';
  const totalEquity = data?.reduce((a, b) => a + b.summary.equity, 0) ?? 0;
  const totalStart = data?.reduce((a, b) => a + b.bot.initialCapital, 0) ?? 0;
  const totalPnl = totalEquity - totalStart;
  const totalPnlPct = totalStart > 0 ? (totalPnl / totalStart) * 100 : 0;

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Mes bots de trading</h1>
          <p className="mt-1 text-sm text-ink-3">Des robots qui achètent et vendent pour vous, sur les vrais cours, avec de l’argent fictif.</p>
        </div>
        <Link
          to="/investir"
          className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-accent px-5 text-[15px] font-semibold text-white hover:bg-[#4a94ea] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-4"
        >
          <Plus aria-hidden /> Nouveau bot
        </Link>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {loading && !data && <Spinner />}

      {/* Le résultat de tous les bots d'un coup d'œil */}
      {data && data.length > 0 && (
        <section aria-label="Vue d'ensemble" className="overflow-hidden rounded-2xl border border-line">
          <div className={cx('border-b border-line bg-surface px-5 py-5 sm:px-6 sm:py-6', sameCurrency && TONE_GLOW[tone(totalPnl)])}>
            {sameCurrency ? (
              <>
                <div className="text-sm font-medium text-ink-3">Valeur totale de vos bots</div>
                <div className="big-num mt-1 text-4xl font-semibold text-ink sm:text-5xl">{fmtMoney(totalEquity, cur)}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <Delta value={totalPnlPct} size="md" />
                  <span className={cx('num text-sm font-semibold', TONE_TEXT[tone(totalPnl)])}>{fmtSignedMoney(totalPnl, cur)}</span>
                  <span className="text-sm text-ink-3">depuis le lancement ({fmtMoney(totalStart, cur, 0)} de capital de départ)</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-ink-3">Vos bots</div>
                <div className="big-num mt-1 text-4xl font-semibold text-ink sm:text-5xl">{data.length}</div>
                <p className="mt-2 text-sm text-ink-3">Vos comptes sont dans plusieurs monnaies : le détail de chacun est ci-dessous.</p>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
            <Kpi label="Bots actifs">
              {running} <span className="text-base font-normal text-ink-3">sur {data.length}</span>
            </Kpi>
            <Kpi label="Ordres passés">{totalTrades}</Kpi>
            <Kpi label="Meilleur bot" className="col-span-2 sm:col-span-1">
              <span className="flex items-center gap-2">
                <span className="truncate">{best?.bot.name}</span>
                <Delta value={best?.summary.pnlPct} />
              </span>
            </Kpi>
          </div>
        </section>
      )}

      {data && data.length === 0 && (
        <section className="overflow-hidden rounded-3xl border border-line bg-[radial-gradient(120%_120%_at_0%_0%,rgba(57,135,229,0.16),transparent_55%)] bg-surface p-5 sm:p-7">
          <EmptyState icon={<Radar />} title="Aucun bot pour l'instant">
            Répondez au questionnaire : le bot choisira les valeurs qui vous correspondent et commencera à trader dès l'ouverture de la bourse.
          </EmptyState>
          <ol className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="flex gap-3 rounded-2xl border border-line bg-page/50 p-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-text [&_svg]:size-[18px]">
                  <Icon aria-hidden />
                </span>
                <div>
                  <div className="text-sm font-semibold text-ink">
                    {i + 1}. {title}
                  </div>
                  <p className="mt-0.5 text-sm leading-snug text-ink-3">{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link to="/investir" className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-accent px-6 text-[15px] font-semibold text-white hover:bg-[#4a94ea] [&_svg]:size-4">
              <Plus aria-hidden /> Créer mon bot
            </Link>
            <Link to="/apprendre" className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-raised px-4 text-sm font-medium text-ink hover:bg-line [&_svg]:size-4">
              <BookOpen aria-hidden /> Comment ça marche ?
            </Link>
          </div>
        </section>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.map((item) => (
            <BotCard key={item.bot.id} item={item} strategyName={strategyName} />
          ))}
        </div>
      )}
    </div>
  );
}

function BotCard({ item: { bot, summary, marketOpen }, strategyName }: { item: BotListItem; strategyName: (id: string) => string }) {
  const running = bot.status === 'running';
  const t = tone(summary.pnl);
  const vsBench = summary.benchmarkPnlPct !== null ? summary.pnlPct - summary.benchmarkPnlPct : null;
  // marketOpen vaut null (ou manque) tant que le bot n'a pas encore observé sa bourse.
  const status = !running
    ? { tone: 'warn' as const, label: 'En pause' }
    : marketOpen == null
      ? { tone: 'up' as const, label: 'Actif' }
      : marketOpen
        ? { tone: 'up' as const, label: 'Bourse ouverte' }
        : { tone: 'neutral' as const, label: 'Bourse fermée' };

  return (
    <Link
      to={`/bots/${bot.id}`}
      className={cx(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent',
        TONE_GLOW[t],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold leading-snug text-ink">{bot.name}</div>
          {bot.profile ? (
            <ProfileBadge level={bot.profile.level} className="mt-1.5" />
          ) : (
            <div className="mt-1 text-xs text-ink-3">Réglé à la main · {strategyName(bot.strategy)}</div>
          )}
        </div>
        <Badge tone={status.tone} className="shrink-0 px-2 py-1">
          <LiveDot on={running && !!marketOpen} />
          {status.label}
        </Badge>
      </div>

      <div className="mt-5">
        <div className="big-num truncate text-3xl font-semibold text-ink">{fmtMoney(summary.equity, bot.currency)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Delta value={summary.pnlPct} size="md" />
          <span className={cx('num text-sm font-semibold', TONE_TEXT[t])}>{fmtSignedMoney(summary.pnl, bot.currency)}</span>
        </div>
      </div>

      <Sparkline
        values={summary.sparkline}
        base={bot.initialCapital}
        color={t === 'flat' ? COLORS.ink3 : t === 'up' ? COLORS.up : COLORS.down}
        area
        className="mt-4 h-20 w-full"
      />

      {summary.tradesCount === 0 && (
        <p className="mt-3 rounded-lg bg-raised/70 px-3 py-2 text-xs leading-relaxed text-ink-2">
          <b className="font-semibold text-ink">Aucun ordre pour l'instant : </b>
          {!running
            ? 'le bot est en pause.'
            : marketOpen === false
              ? 'la bourse est fermée, il commencera à la prochaine ouverture.'
              : 'il attend un signal de sa stratégie. Ouvrez-le pour voir ce qu’il surveille.'}
        </p>
      )}

      <div className="num mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
        <div>
          <div className="text-ink-3">Ordres</div>
          <div className="mt-0.5 text-sm font-medium text-ink">{summary.tradesCount}</div>
        </div>
        <div>
          <div className="text-ink-3">Trades gagnants</div>
          <div className="mt-0.5 text-sm font-medium text-ink">{summary.winRate === null ? '–' : fmtPct(summary.winRate, 0, false)}</div>
        </div>
        <div>
          <div className="text-ink-3">vs acheter-garder</div>
          <div className={cx('mt-0.5 text-sm font-medium', vsBench === null ? 'text-ink-3' : TONE_TEXT[tone(vsBench)])}>
            {vsBench === null ? '–' : Math.abs(vsBench) < 0.005 ? 'pareil' : `${vsBench > 0 ? '+' : '−'}${fmtNum(Math.abs(vsBench), 1)} pt`}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {bot.symbols.slice(0, 5).map((s, i) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
              <span className="size-1.5 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
              {assetInfo(s)?.name ?? s}
            </span>
          ))}
          {bot.symbols.length > 5 && <span className="px-1 text-[11px] text-ink-3">+{bot.symbols.length - 5}</span>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-ink-3 group-hover:text-ink-2">
          {fmtDate(bot.createdAt)} <ChevronRight className="size-3.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
