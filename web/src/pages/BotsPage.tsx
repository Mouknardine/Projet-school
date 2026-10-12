// Page d'accueil : liste des bots et leurs performances.

import { Bot as BotIcon, BookOpen, ChartNoAxesCombined, MessageSquareText, Plus, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { useAppData } from '../App.tsx';
import { SERIES, Sparkline } from '../components/charts.tsx';
import { Badge, Delta, EmptyState, ErrorBox, LiveDot, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtDate, fmtMoney, fmtNum, fmtSignedMoney, pnlClass } from '../lib/format.ts';
import { usePolling } from '../lib/usePolling.ts';

const STEPS = [
  { icon: Wallet, title: 'On lui donne un capital', text: 'On choisit la somme de départ (fictive), les actions à suivre et une stratégie.' },
  { icon: ChartNoAxesCombined, title: 'Il décide tout seul', text: 'Le bot analyse les vrais cours chaque minute et achète ou vend selon ses règles.' },
  { icon: MessageSquareText, title: 'Il explique tout', text: 'Chaque achat et chaque vente est enregistré avec la raison de la décision et son résultat.' },
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
          Des robots qui investissent en bourse, avec de l'argent fictif
        </h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-2">
          Chaque bot reçoit un capital de départ et suit les <b className="font-semibold text-ink">vrais cours de la bourse</b>. Il décide tout seul d'acheter ou de
          vendre des actions grâce à sa stratégie, et il explique chacune de ses décisions.
        </p>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink">
          <b className="font-semibold">Le but :</b> vérifier si un algorithme fait mieux que simplement acheter des actions et attendre.
        </p>
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
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/bots/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-[#4a94ea] [&_svg]:size-4"
          >
            <Plus aria-hidden /> Créer un bot
          </Link>
          <Link
            to="/apprendre"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-raised px-4 text-sm font-medium text-ink hover:bg-line [&_svg]:size-4"
          >
            <BookOpen aria-hidden /> Comment ça marche ?
          </Link>
        </div>
      </section>

      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">Mes bots</h2>
        <p className="mt-1 text-sm text-ink-3">Touchez un bot pour voir ce qu'il possède, ses trades et pourquoi il les a faits.</p>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {loading && !data && <Spinner />}

      {data && data.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-line bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
            <div className="text-xs font-medium text-ink-3">Bots actifs</div>
            <div className="mt-1 text-2xl font-semibold text-ink">
              {running} <span className="text-base font-normal text-ink-3">sur {data.length}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
            <div className="text-xs font-medium text-ink-3">Achats et ventes au total</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{totalTrades}</div>
          </div>
          <div className="col-span-2 min-w-0 rounded-2xl border border-line bg-surface px-4 py-3.5 sm:col-span-1 sm:px-5 sm:py-4">
            <div className="text-xs font-medium text-ink-3">Meilleur bot pour l'instant</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate text-2xl font-semibold text-ink">{best?.bot.name}</span>
              <Delta value={best?.summary.pnlPct} />
            </div>
          </div>
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<BotIcon />} title="Aucun bot pour l'instant">
            Créez votre premier bot : choisissez un capital, des actions et une stratégie. Il commencera à trader dès l'ouverture de la bourse.
          </EmptyState>
          <div className="flex justify-center gap-3 pb-10">
            <Link to="/bots/new" className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-[#4a94ea]">
              Créer un bot
            </Link>
            <Link to="/backtest" className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm text-ink-2 hover:bg-raised">
              Tester une stratégie sur le passé
            </Link>
          </div>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.map(({ bot, summary }) => {
            const vsBench = summary.benchmarkPnlPct !== null ? summary.pnlPct - summary.benchmarkPnlPct : null;
            return (
              <Link
                key={bot.id}
                to={`/bots/${bot.id}`}
                className="group rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{bot.name}</div>
                    <div className="mt-0.5 truncate text-xs text-ink-3">Stratégie : {strategyName(bot.strategy)}</div>
                  </div>
                  <Badge tone={bot.status === 'running' ? 'up' : 'warn'}>
                    <LiveDot on={bot.status === 'running'} />
                    {bot.status === 'running' ? 'Actif' : 'En pause'}
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

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {bot.symbols.map((s, i) => (
                    <span key={s} className="inline-flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
                      <span className="size-1.5 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
                      {s}
                    </span>
                  ))}
                </div>

                <div className="num mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                  <div>
                    <div className="text-ink-3">Achats / ventes</div>
                    <div className="mt-0.5 text-ink">{summary.tradesCount}</div>
                  </div>
                  <div>
                    <div className="text-ink-3">vs acheter et garder</div>
                    <div className={`mt-0.5 ${pnlClass(vsBench)}`}>{vsBench === null ? '–' : `${vsBench > 0 ? '+' : ''}${fmtNum(vsBench)} pts`}</div>
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
