import { BookOpen, FlaskConical, LayoutDashboard, Plus } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router';
import type { AppConfig, StrategyInfo } from '../../shared/types.ts';
import { cx, Delta, ErrorBox, LiveDot, Spinner } from './components/ui.tsx';
import { api } from './lib/api.ts';
import { usePolling } from './lib/usePolling.ts';
import { BacktestPage } from './pages/BacktestPage.tsx';
import { BotPage } from './pages/BotPage.tsx';
import { BotsPage } from './pages/BotsPage.tsx';
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
  return (
    <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#3987e5" />
      <path d="M7 21.5l5.5-6.5 4.5 3.5 8-9.5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV = [
  { to: '/', label: 'Mes bots', icon: LayoutDashboard, end: true },
  { to: '/backtest', label: 'Backtest', icon: FlaskConical, end: false },
  { to: '/apprendre', label: 'Comment ça marche', icon: BookOpen, end: false },
];

function SidebarBots() {
  const { data } = usePolling(() => api.bots(), [], 20_000);
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Bots</span>
        <Link to="/bots/new" className="rounded-md p-1 text-ink-3 hover:bg-raised hover:text-ink" aria-label="Nouveau bot">
          <Plus className="size-4" />
        </Link>
      </div>
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
        {data && data.length === 0 && <li className="px-3 py-2 text-xs text-ink-3">Aucun bot pour l'instant</li>}
      </ul>
    </div>
  );
}

function Layout({ children, ready }: { children: ReactNode; ready: boolean }) {
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
            <span className="block text-[11px] text-ink-3">Trading algorithmique · TIP</span>
          </span>
        </Link>
        <nav className="mt-7 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={link}>
              <Icon aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        {ready && <SidebarBots />}
        <div className="mt-auto rounded-xl border border-line bg-page/60 p-3 text-xs leading-relaxed text-ink-3">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink-2">
            <span className="size-1.5 rounded-full bg-warn" /> Paper trading
          </div>
          Cours réels (Yahoo Finance), argent fictif. Aucun ordre n'est passé sur un vrai marché.
        </div>
      </aside>

      {/* Barre du haut (mobile / tablette) */}
      <header className="sticky top-0 z-30 border-b border-line bg-page/90 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <Logo />
            <span className="font-bold tracking-tight text-ink">TradeBot</span>
          </Link>
          <nav className="ml-auto flex gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={label}
                className={({ isActive }) => cx('rounded-lg p-2 [&_svg]:size-5', isActive ? 'bg-raised text-ink' : 'text-ink-3')}
              >
                <Icon aria-hidden />
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      <footer className="mx-auto max-w-[1400px] px-4 pb-8 text-xs text-ink-3 sm:px-6 lg:px-8">
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
