// Page d'accueil : à quoi sert l'application, puis la liste des placements et leurs résultats.

import { BookOpen, ClipboardList, MessageSquareText, Sparkles, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { useAppData } from '../App.tsx';
import { SERIES, Sparkline } from '../components/charts.tsx';
import { ProfileBadge } from '../components/profile.tsx';
import { Badge, Delta, EmptyState, ErrorBox, LiveDot, Spinner } from '../components/ui.tsx';
import { assetInfo } from '../../../shared/profile.ts';
import { api } from '../lib/api.ts';
import { fmtDate, fmtMoney, fmtNum, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { usePolling } from '../lib/usePolling.ts';

const STEPS = [
  { icon: ClipboardList, title: 'Vous répondez à quelques questions', text: 'Sur votre situation et le risque que vous acceptez. Environ 3 minutes.' },
  { icon: Sparkles, title: 'Le bot choisit et investit', text: 'Il en déduit votre profil, choisit lui-même les actions et achète ou vend tout seul, sur les vrais cours.' },
  { icon: MessageSquareText, title: 'Vous suivez, sans rien décider', text: 'Graphiques à l’appui, chaque achat et chaque vente est expliqué en français.' },
];

export function BotsPage() {
  const { strategies } = useAppData();
  const { data, error, loading } = usePolling(() => api.bots(), [], 15_000);
  const strategyName = (id: string) => strategies.find((s) => s.id === id)?.short ?? id;
  const running = data?.filter((b) => b.bot.status === 'running').length ?? 0;
  const totalTrades = data?.reduce((a, b) => a + b.summary.tradesCount, 0) ?? 0;
  const best = data && data.length ? [...data].sort((a, b) => b.summary.pnlPct - a.summary.pnlPct)[0] : null;

  return (
    <div className="animate-fade-up space-y-6">
      {/* À quoi sert l'application */}
      <section className="overflow-hidden rounded-3xl border border-line bg-[radial-gradient(120%_120%_at_0%_0%,rgba(57,135,229,0.16),transparent_55%)] bg-surface p-5 sm:p-7">
        <h1 className="max-w-3xl text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
          Placez votre argent, un robot s'occupe du reste
        </h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-2">
          Pas besoin d'y connaître quoi que ce soit. Le bot s'adapte à ce que vous acceptez de risquer, choisit les actions à votre place et les achète ou les
          vend tout seul sur les <b className="font-semibold text-ink">vrais cours de la bourse</b>, avec de l'<b className="font-semibold text-ink">argent fictif</b>.
        </p>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink">
          <b className="font-semibold">La question du projet :</b> peut-on investir avec un robot, sans prendre soi-même aucune décision ?
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/investir"
            className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-accent px-5 text-[15px] font-semibold text-white hover:bg-[#4a94ea] [&_svg]:size-4"
          >
            <Sparkles aria-hidden /> Commencer
          </Link>
          <Link
            to="/apprendre"
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-line bg-raised px-4 text-sm font-medium text-ink hover:bg-line [&_svg]:size-4"
          >
            <BookOpen aria-hidden /> Comment ça marche ?
          </Link>
        </div>
        <ol className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
      </section>

      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">Mes placements</h2>
        <p className="mt-1 text-sm text-ink-3">Touchez un placement pour voir ce que le bot a acheté, sur un graphique, et pourquoi.</p>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {loading && !data && <Spinner />}

      {data && data.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-line bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
            <div className="text-xs font-medium text-ink-3">Placements actifs</div>
            <div className="mt-1 text-2xl font-semibold text-ink">
              {running} <span className="text-base font-normal text-ink-3">sur {data.length}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
            <div className="text-xs font-medium text-ink-3">Achats et ventes au total</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{totalTrades}</div>
          </div>
          <div className="col-span-2 min-w-0 rounded-2xl border border-line bg-surface px-4 py-3.5 sm:col-span-1 sm:px-5 sm:py-4">
            <div className="text-xs font-medium text-ink-3">Meilleur placement pour l'instant</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate text-2xl font-semibold text-ink">{best?.bot.name}</span>
              <Delta value={best?.summary.pnlPct} />
            </div>
          </div>
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<Wallet />} title="Aucun placement pour l'instant">
            Répondez au questionnaire : le bot choisira les actions qui vous correspondent et commencera à investir dès l'ouverture de la bourse.
          </EmptyState>
          <div className="flex justify-center gap-3 pb-10">
            <Link to="/investir" className="inline-flex h-10 items-center rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-[#4a94ea]">
              Commencer
            </Link>
          </div>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.map(({ bot, summary, marketOpen }) => {
            const vsBench = summary.benchmarkPnlPct !== null ? summary.pnlPct - summary.benchmarkPnlPct : null;
            const running = bot.status === 'running';
            // marketOpen vaut null (ou manque) tant que le bot n'a pas encore observé sa bourse.
            const status = !running
              ? { tone: 'warn' as const, label: 'En pause' }
              : marketOpen == null
                ? { tone: 'up' as const, label: 'Actif' }
                : marketOpen
                  ? { tone: 'up' as const, label: 'Actif · bourse ouverte' }
                  : { tone: 'neutral' as const, label: 'Actif · bourse fermée' };
            return (
              <Link
                key={bot.id}
                to={`/bots/${bot.id}`}
                className="group rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold leading-snug text-ink">{bot.name}</div>
                    {bot.profile ? (
                      <ProfileBadge level={bot.profile.level} className="mt-1.5" />
                    ) : (
                      <div className="mt-0.5 text-xs text-ink-3">Réglé à la main · stratégie : {strategyName(bot.strategy)}</div>
                    )}
                  </div>
                  <Badge tone={status.tone} className="shrink-0">
                    <LiveDot on={running && !!marketOpen} />
                    {status.label}
                  </Badge>
                </div>

                <div className="mt-5 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-ink-3">Valeur aujourd'hui (départ : {fmtMoney(bot.initialCapital, bot.currency)})</div>
                    <div className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-ink">{fmtMoney(summary.equity, bot.currency)}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Delta value={summary.pnlPct} />
                      <span className={`text-xs ${pnlClass(summary.pnl)}`}>{fmtSignedMoney(summary.pnl, bot.currency)}</span>
                    </div>
                  </div>
                  <Sparkline values={summary.sparkline} base={bot.initialCapital} color={SERIES[0]} className="h-12 w-32 shrink-0" />
                </div>

                {summary.tradesCount === 0 && (
                  <p className="mt-4 rounded-lg bg-raised/70 px-3 py-2 text-xs leading-relaxed text-ink-2">
                    <b className="font-semibold text-ink">Rien acheté pour l'instant : </b>
                    {!running
                      ? 'le bot est en pause.'
                      : marketOpen === false
                        ? "la bourse est fermée, il commencera à la prochaine ouverture."
                        : "il attend le bon moment selon sa stratégie. Ouvrez-le pour voir ce qu'il attend pour chaque action."}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {bot.symbols.map((s, i) => (
                    <span key={s} className="inline-flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
                      <span className="size-1.5 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
                      {assetInfo(s)?.name ?? s}
                    </span>
                  ))}
                </div>

                <div className="num mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                  <div>
                    <div className="text-ink-3">Achats / ventes</div>
                    <div className="mt-0.5 text-ink">{summary.tradesCount}</div>
                  </div>
                  <div>
                    <div className="text-ink-3">Comparé à « acheter et garder »</div>
                    <div className={`mt-0.5 ${pnlClass(vsBench)}`}>
                      {vsBench === null ? '–' : Math.abs(vsBench) < 0.005 ? 'pareil' : `${fmtNum(Math.abs(vsBench))} % ${vsBench > 0 ? 'de mieux' : 'de moins'}`}
                    </div>
                  </div>
                  <div>
                    <div className="text-ink-3">Lancé le</div>
                    <div className="mt-0.5 text-ink">{fmtDate(bot.createdAt)}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
