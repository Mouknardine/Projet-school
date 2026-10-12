import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router';
import type { AppConfig, StrategyInfo } from '../../shared/types.ts';
import { cx, ErrorBox, Spinner } from './components/ui.tsx';
import { api } from './lib/api.ts';
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
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0f172a" stroke="#1e293b" />
      <path d="M6 22l6-7 5 4 9-11" stroke="#34d399" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const link = ({ isActive }: { isActive: boolean }) =>
    cx('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-100');
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2">
            <Logo />
            <span className="text-base font-bold tracking-tight text-white">TradeBot</span>
          </NavLink>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/" end className={link}>
              Mes bots
            </NavLink>
            <NavLink to="/backtest" className={link}>
              Backtest
            </NavLink>
            <NavLink to="/apprendre" className={link}>
              Comment ça marche
            </NavLink>
          </nav>
          <span className="ml-auto hidden rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30 sm:inline">
            Paper trading · cours réels · argent fictif
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-4 text-xs text-slate-500">
        Projet scolaire (TIP) — simulation de trading algorithmique. Données : Yahoo Finance (peuvent être différées). Graphiques :{' '}
        <a href="https://www.tradingview.com/" className="underline hover:text-slate-300" target="_blank" rel="noreferrer">
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
      <Layout>
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
