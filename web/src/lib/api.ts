// Client de l'API du serveur.

import type {
  AppConfig,
  BacktestRequest,
  BacktestResult,
  BotConfig,
  BotDetail,
  BotListItem,
  BotStatus,
  ChartResponse,
  EquityPoint,
  LogEntry,
  StrategyInfo,
  SymbolSearchResult,
  Trade,
} from '../../../shared/types.ts';

const PASSWORD_KEY = 'tradebot.adminPassword';

/**
 * Adresse du serveur. Vide en local (le serveur de développement relaie /api),
 * et l'URL des fonctions Supabase une fois en ligne (voir web/.env.vercel).
 */
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public authRequired = false,
  ) {
    super(message);
  }
}

function getPassword(): string | null {
  try {
    return localStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

function setPassword(pw: string | null) {
  try {
    if (pw) localStorage.setItem(PASSWORD_KEY, pw);
    else localStorage.removeItem(PASSWORD_KEY);
  } catch {
    // Stockage indisponible (navigation privée) : le mot de passe sera redemandé.
  }
}

let sessionPassword: string | null = null;

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  // Les lectures (GET) partent sans en-tête particulier : le navigateur n'a alors pas besoin
  // d'une requête de vérification CORS préalable, ce qui divise par deux les appels à l'API en ligne.
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const pw = sessionPassword ?? getPassword();
  if (pw && method !== 'GET') headers['x-admin-password'] = pw;
  const res = await fetch(`${API_BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.authRequired && retry) {
      const entered = window.prompt('Mot de passe administrateur du bot :');
      if (entered) {
        sessionPassword = entered;
        setPassword(entered);
        return request<T>(method, path, body, false);
      }
    }
    if (res.status === 401) {
      sessionPassword = null;
      setPassword(null);
    }
    throw new ApiError(data.error ?? `Erreur ${res.status}`, res.status, !!data.authRequired);
  }
  return data as T;
}

export const api = {
  config: () => request<AppConfig>('GET', '/config'),
  strategies: () => request<StrategyInfo[]>('GET', '/strategies'),
  search: (q: string) => request<SymbolSearchResult[]>('GET', `/market/search?q=${encodeURIComponent(q)}`),

  bots: () => request<BotListItem[]>('GET', '/bots'),
  bot: (id: number) => request<BotDetail>('GET', `/bots/${id}`),
  createBot: (cfg: BotConfig) => request<BotDetail>('POST', '/bots', cfg),
  updateBot: (id: number, patch: { status?: BotStatus; name?: string }) => request<BotDetail>('PATCH', `/bots/${id}`, patch),
  tick: (id: number) => request<BotDetail>('POST', `/bots/${id}/tick`),
  reset: (id: number) => request<BotDetail>('POST', `/bots/${id}/reset`),
  deleteBot: (id: number) => request<void>('DELETE', `/bots/${id}`),
  closePosition: (id: number, symbol: string) => request<BotDetail>('POST', `/bots/${id}/positions/${encodeURIComponent(symbol)}/close`),

  trades: (id: number) => request<Trade[]>('GET', `/bots/${id}/trades`),
  equity: (id: number) => request<EquityPoint[]>('GET', `/bots/${id}/equity`),
  logs: (id: number, limit = 100) => request<LogEntry[]>('GET', `/bots/${id}/logs?limit=${limit}`),
  chart: (id: number, symbol: string) => request<ChartResponse>('GET', `/bots/${id}/chart?symbol=${encodeURIComponent(symbol)}`),
  csvUrl: (id: number) => `${API_BASE}/api/bots/${id}/trades.csv`,

  backtest: (req: BacktestRequest) => request<BacktestResult>('POST', '/backtest', req),
};
