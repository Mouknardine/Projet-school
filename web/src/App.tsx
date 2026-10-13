import { BookOpen, Sparkles, Wallet } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router';
import type { AppConfig, StrategyInfo } from '../../shared/types.ts';
import { cx, Delta, ErrorBox, LiveDot, Spinner } from './components/ui.tsx';
import { api } from './lib/api.ts';
import { usePolling } from './lib/usePolling.ts';
import { BacktestPage } from './pages/BacktestPage.tsx';
import { BotPage } from './pages/BotPage.tsx';
import { BotsPage } from './pages/BotsPage.tsx';
import { InvestPage } from './pages/InvestPage.tsx';
import { LearnPage } from './pages/LearnPage.tsx';
import { NewBotPage } from './pages/NewBotPage.tsx';

interface AppData {
  config: AppConfig;
  strategies: StrategyInfo[];
}

const AppDataContext = createContext<AppData | null>(null);

/** Configuration du serveur et liste des stratégies, chargées une seule fois au démarrage. */
export function useAppData(): AppData {
  const data = useContext(AppDataContext);
  if (!data) throw new Error('AppData non chargé');
  return data;
}

function Logo() {
  return <img src="/icon.svg" alt="" className="size-9 shrink-0 rounded-[10px]" width={36} height={36} />;
}

/** Les menus, avec un libellé court (barre du bas sur mobile) et un libellé complet (barre latérale). */
const NAV = [
  { to: '/', short: 'Mes placements', label: 'Mes placements', icon: Wallet, end: true },
  { to: '/investir', short: 'Investir', label: 'Nouveau placement', icon: Sparkles, end: true },
  { to: '/apprendre', short: 'Comprendre', label: 'Comment ça marche', icon: BookOpen, end: false },
];

/** Les pages d'un bot font partie de l'onglet « Mes bots ». */
function isBotsTab(pathname: string) {
  return pathname === '/' || (pathname.startsWith('/bots/') && pathname !== '/bots/new');
}

function SidebarBots() {
  const { data } = usePolling(() => api.bots(), [], 20_000);
  return (
    <div className="mt-6">
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Mes placements</div>
      <ul className="space-y-0.5">
        {(data ?? []).map(({ bot, summary }) => (
          <li key={bot.id}>
            <NavLink
              to={`/bots/${bot.id}`}
              className={({ isActive }) =>
                cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-raised text-ink' : 'text-ink-2 hover:bg-raised/60 hover:text-ink')
              }
            >
              <LiveDot on={bot.status === 'running'} />
              <span className="min-w-0 flex-1 truncate">{bot.name}</span>
              <Delta value={summary.pnlPct} className="!bg-transparent !px-0" />
            </NavLink>
          </li>
        ))}
        {data && data.length === 0 && <li className="px-3 py-2 text-xs text-ink-3">Aucun placement pour l'instant</li>}
      </ul>
    </div>
  );
}

function Layout({ children, ready }: { children: ReactNode; ready: boolean }) {
  const { pathname } = useLocation();
  const link = ({ isActive }: { isActive: boolean }) =>
    cx(
      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-4',
      isActive ? 'bg-raised text-ink' : 'text-ink-2 hover:bg-raised/60 hover:text-ink',
    );
  return (
    <div className="min-h-screen lg:pl-64">
      {/* Barre latérale (ordinateur) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <Link to="/" className="flex items-center gap-2.5 px-3">
          <Logo />
          <span>
            <span className="block text-[15px] font-bold leading-tight tracking-tight text-ink">TradeBot</span>
            <span className="block text-[11px] text-ink-3">Un robot investit pour vous · TIP</span>
          </span>
        </Link>
        <nav className="mt-7 space-y-0.5" aria-label="Menu principal">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={(p) => link({ isActive: to === '/' ? isBotsTab(pathname) : p.isActive })}>
              <Icon aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        {ready && <SidebarBots />}
        <div className="mt-auto rounded-xl border border-line bg-page/60 p-3 text-xs leading-relaxed text-ink-3">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink-2">
            <span className="size-1.5 rounded-full bg-warn" /> Simulation : argent fictif
          </div>
          Les cours de bourse sont réels (Yahoo Finance), mais l'argent est fictif : aucun ordre n'est passé sur un vrai marché.
        </div>
      </aside>

      {/* Barre du haut (mobile / tablette) : le nom de l'app et le rappel qu'il s'agit d'une simulation. */}
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-page/90 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2">
            <Logo />
            <span>
              <span className="block text-[15px] font-bold leading-tight tracking-tight text-ink">TradeBot</span>
              <span className="block text-[11px] leading-tight text-ink-3">Un robot investit pour vous</span>
            </span>
          </Link>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-[11px] font-medium text-warn">
            <span className="size-1.5 rounded-full bg-warn" aria-hidden /> Argent fictif
          </span>
        </div>
      </header>

      {/* Barre d'onglets du bas (mobile / tablette) : chaque menu a une icône ET un nom. */}
      <nav aria-label="Menu principal" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-3">
          {NAV.map(({ to, short, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => {
                  const active = to === '/' ? isBotsTab(pathname) : isActive;
                  return cx(
                    'flex flex-col items-center gap-1 px-1 pt-2 pb-2 text-[11px] font-medium leading-none transition-colors [&_svg]:size-[22px]',
                    active ? 'text-accent-text' : 'text-ink-3 hover:text-ink-2',
                  );
                }}
              >
                {({ isActive }) => {
                  const active = to === '/' ? isBotsTab(pathname) : isActive;
                  return (
                    <>
                      <span className={cx('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-accent/15')}>
                        <Icon aria-hidden strokeWidth={active ? 2.4 : 2} />
                      </span>
                      <span className="whitespace-nowrap">{short}</span>
                    </>
                  );
                }}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mx-auto max-w-[1400px] px-4 pt-5 pb-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      <footer className="mx-auto max-w-[1400px] px-4 pb-28 text-xs text-ink-3 sm:px-6 lg:px-8 lg:pb-8">
        Projet scolaire (TIP) — simulation de trading algorithmique. Données : Yahoo Finance (peuvent être différées). Graphiques en chandeliers :{' '}
        <a href="https://www.tradingview.com/" className="underline hover:text-ink-2" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts
        </a>
        . Aucun conseil en investissement.
      </footer>
    </div>
  );
}

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.config(), api.strategies()])
      .then(([config, strategies]) => setData({ config, strategies }))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <BrowserRouter>
      <Layout ready={!!data}>
        {error ? (
          <ErrorBox>Impossible de contacter le serveur du bot : {error}</ErrorBox>
        ) : !data ? (
          <Spinner />
        ) : (
          <AppDataContext.Provider value={data}>
            <Routes>
              <Route path="/" element={<BotsPage />} />
              <Route path="/investir" element={<InvestPage />} />
              <Route path="/bots/new" element={<NewBotPage />} />
              <Route path="/bots/:id" element={<BotPage />} />
              <Route path="/backtest" element={<BacktestPage />} />
              <Route path="/apprendre" element={<LearnPage />} />
              <Route path="*" element={<ErrorBox>Page introuvable.</ErrorBox>} />
            </Routes>
          </AppDataContext.Provider>
        )}
      </Layout>
    </BrowserRouter>
  );
}
