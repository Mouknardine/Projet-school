// Routes de l'API REST utilisées par le dashboard.
// Écrite avec Hono, qui fonctionne aussi bien sous Node.js (serveur local) que sous Deno (Supabase Edge Functions).

import crypto from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type {
  AppConfig,
  BacktestResult,
  BotConfig,
  BotDetail,
  BotListItem,
  ChartResponse,
  Interval,
  LogLevel,
  Quote,
  StrategyId,
} from '../shared/types.ts';
import { getChart, getQuote, MarketDataError, RANGE_LABELS, RANGES, rangeFor, searchSymbols } from './market/yahoo.ts';
import type { Repo } from './repo.ts';
import { BacktestError, runBacktest } from './trading/backtest.ts';
import { sell, tickAllBots, tickBot } from './trading/engine.ts';
import { downsample } from './trading/stats.ts';
import { getStrategy, normalizeParams, STRATEGIES, STRATEGY_IDS } from './trading/strategies.ts';
import { computeSummary, positionsView } from './trading/summary.ts';

z.config(z.locales.fr());

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AppDeps {
  repo: Repo;
  tickSeconds: number;
  /** Mot de passe administrateur attendu (null = aucun mot de passe, tout le monde peut modifier). */
  adminPassword: () => Promise<string | null>;
  /** Secret attendu par la route appelée chaque minute par le planificateur du cloud (null = route désactivée). */
  cronSecret?: () => Promise<string | null>;
}

const INTERVALS: Interval[] = ['5m', '15m', '1h', '1d'];
const INTERVAL_LABELS: Record<Interval, string> = {
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 heure',
  '1d': '1 jour',
};

const configSchema = z.object({
  initialCapital: z.number().min(100).max(100_000_000),
  symbols: z
    .array(
      z
        .string()
        .trim()
        .toUpperCase()
        .min(1)
        .max(20)
        .regex(/^[A-Z0-9.\-=^]+$/, 'Symbole invalide'),
    )
    .min(1, 'Choisissez au moins une action')
    .max(10, '10 actions au maximum'),
  strategy: z.enum(STRATEGY_IDS as [StrategyId, ...StrategyId[]]),
  params: z.record(z.string(), z.number()).optional().default({}),
  interval: z.enum(INTERVALS as [Interval, ...Interval[]]),
  positionSizePct: z.number().min(1).max(100),
  stopLossPct: z.number().min(0).max(90),
  takeProfitPct: z.number().min(0).max(1000),
  feePct: z.number().min(0).max(5),
  allowFractional: z.boolean(),
});
const createBotSchema = configSchema.extend({ name: z.string().trim().min(1).max(60) });
const backtestSchema = configSchema.extend({ range: z.string() });
const patchBotSchema = z.object({
  status: z.enum(['running', 'paused']).optional(),
  name: z.string().trim().min(1).max(60).optional(),
});

async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, 'Requête JSON invalide');
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const msg = result.error.issues.map((i) => (i.path.length ? `${i.path.join('.')} : ${i.message}` : i.message)).join(' ; ');
    throw new HttpError(400, msg);
  }
  return result.data;
}

/** Vérifie les paramètres et récupère le cours actuel de chaque action (ce qui valide aussi les symboles). */
async function prepareConfig<T extends Omit<BotConfig, 'name'>>(input: T): Promise<{ cfg: T; quotes: Quote[]; currency: string }> {
  const strategy = getStrategy(input.strategy);
  const params = normalizeParams(input.strategy, input.params);
  const invalid = strategy.validate?.(params);
  if (invalid) throw new HttpError(400, invalid);
  const symbols = [...new Set(input.symbols)];

  const quotes = await Promise.all(
    symbols.map(async (s) => {
      try {
        return await getQuote(s);
      } catch (err) {
        if (err instanceof MarketDataError) throw new HttpError(400, `${s} : ${err.message}`);
        throw err;
      }
    }),
  );
  const currencies = [...new Set(quotes.map((q) => q.currency))];
  if (currencies.length > 1) {
    const detail = quotes.map((q) => `${q.symbol} : ${q.currency}`).join(', ');
    throw new HttpError(400, `Toutes les actions doivent être cotées dans la même devise (${detail}). Créez un bot par marché.`);
  }
  return { cfg: { ...input, params, symbols }, quotes, currency: currencies[0] };
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();

function sameSecret(given: string, expected: string): boolean {
  return crypto.timingSafeEqual(sha256(given), sha256(expected));
}

/** Nombre de bougies affichées au minimum sur le graphique d'un bot, et au maximum envoyées au navigateur. */
const DISPLAY_BARS = 300;
const MAX_CHART_BARS = 600;

export function createApi(deps: AppDeps): Hono {
  const { repo } = deps;
  const api = new Hono();

  api.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'x-admin-password', 'Authorization', 'apikey', 'x-client-info'],
    }),
  );

  /** Si un mot de passe administrateur est configuré, il est exigé pour toute modification. */
  const requireAdmin: MiddlewareHandler = async (c, next) => {
    const expected = await deps.adminPassword();
    if (!expected || sameSecret(c.req.header('x-admin-password') ?? '', expected)) return next();
    return c.json({ error: 'Mot de passe administrateur requis ou incorrect.', authRequired: true }, 401);
  };

  const botId = (c: Context) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) throw new HttpError(404, 'Bot introuvable');
    return id;
  };

  const loadBot = async (c: Context) => {
    const bot = await repo.getBot(botId(c));
    if (!bot) throw new HttpError(404, 'Bot introuvable');
    return bot;
  };

  const botDetail = async (id: number): Promise<BotDetail> => {
    const bot = await repo.getBot(id);
    if (!bot) throw new HttpError(404, 'Bot introuvable');
    // Requêtes l'une après l'autre (plus robuste avec certains « poolers » Postgres que des requêtes parallèles).
    const positions = await positionsView(repo, bot);
    const state = await repo.getBotState(id);
    const watchlist = bot.symbols.map((symbol) => {
      const price = state.lastPrice[symbol] ?? null;
      const start = bot.startPrices[symbol];
      const prev = state.prevClose[symbol];
      return {
        symbol,
        name: state.names[symbol] ?? null,
        price,
        marketOpen: state.marketOpen[symbol] ?? null,
        sinceStartPct: price !== null && start ? (price / start - 1) * 100 : null,
        dayChangePct: price !== null && prev ? (price / prev - 1) * 100 : null,
        spark: state.spark[symbol] ?? [],
      };
    });
    return { bot, summary: await computeSummary(repo, bot, positions), positions, strategy: getStrategy(bot.strategy).info, watchlist };
  };

  api.get('/config', async (c) => {
    const body: AppConfig = {
      authRequired: !!(await deps.adminPassword()),
      tickSeconds: deps.tickSeconds,
      intervals: INTERVALS.map((id) => ({
        id,
        label: INTERVAL_LABELS[id],
        backtestRanges: RANGES[id].map((r) => ({ id: r, label: RANGE_LABELS[r] })),
      })),
    };
    return c.json(body);
  });

  api.post('/auth/check', requireAdmin, (c) => c.json({ ok: true }));

  api.get('/strategies', (c) => c.json(Object.values(STRATEGIES).map((s) => s.info)));

  // --- Données de marché ---------------------------------------------------

  api.get('/market/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 1) return c.json([]);
    try {
      return c.json(await searchSymbols(q));
    } catch (err) {
      if (err instanceof MarketDataError) throw new HttpError(502, err.message);
      throw err;
    }
  });

  api.get('/market/quote/:symbol', async (c) => {
    try {
      return c.json(await getQuote(c.req.param('symbol').toUpperCase()));
    } catch (err) {
      if (err instanceof MarketDataError) throw new HttpError(404, err.message);
      throw err;
    }
  });

  // --- Bots ----------------------------------------------------------------

  api.get('/bots', async (c) => {
    const bots = await repo.listBots();
    const items: BotListItem[] = [];
    for (const bot of bots) items.push({ bot, summary: await computeSummary(repo, bot) });
    return c.json(items);
  });

  api.post('/bots', requireAdmin, async (c) => {
    const input = await parseBody(c, createBotSchema);
    const { cfg, quotes, currency } = await prepareConfig(input);
    const startPrices = Object.fromEntries(cfg.symbols.map((s, i) => [s, quotes[i].price]));
    const id = await repo.insertBot(cfg, currency, startPrices, Date.now());
    const strategy = getStrategy(cfg.strategy);
    await repo.insertLog(
      id,
      'info',
      null,
      `Bot créé avec ${cfg.initialCapital.toFixed(2)} ${currency} — stratégie « ${strategy.info.name} », bougies de ${INTERVAL_LABELS[cfg.interval]}, actions suivies : ${cfg.symbols.join(', ')}`,
    );
    await tickBot(repo, id, { force: true });
    return c.json(await botDetail(id), 201);
  });

  api.get('/bots/:id', async (c) => c.json(await botDetail((await loadBot(c)).id)));

  api.patch('/bots/:id', requireAdmin, async (c) => {
    const bot = await loadBot(c);
    const body = await parseBody(c, patchBotSchema);
    if (body.name) await repo.setBotName(bot.id, body.name);
    if (body.status && body.status !== bot.status) {
      await repo.setBotStatus(bot.id, body.status);
      await repo.insertLog(bot.id, 'info', null, body.status === 'paused' ? 'Bot mis en pause : plus aucun ordre ne sera passé' : 'Bot relancé');
    }
    return c.json(await botDetail(bot.id));
  });

  api.post('/bots/:id/tick', requireAdmin, async (c) => {
    const bot = await loadBot(c);
    await tickBot(repo, bot.id, { force: true });
    return c.json(await botDetail(bot.id));
  });

  api.post('/bots/:id/reset', requireAdmin, async (c) => {
    const bot = await loadBot(c);
    const { quotes } = await prepareConfig(bot);
    const startPrices = Object.fromEntries(bot.symbols.map((s, i) => [s, quotes[i].price]));
    await repo.resetBot(bot.id, startPrices, Date.now());
    await repo.insertLog(bot.id, 'info', null, `Bot réinitialisé avec ${bot.initialCapital.toFixed(2)} ${bot.currency}`);
    await tickBot(repo, bot.id, { force: true });
    return c.json(await botDetail(bot.id));
  });

  api.delete('/bots/:id', requireAdmin, async (c) => {
    await repo.deleteBot((await loadBot(c)).id);
    return c.body(null, 204);
  });

  /** Vente manuelle d'une position, au cours actuel (uniquement si le marché est ouvert). */
  api.post('/bots/:id/positions/:symbol/close', requireAdmin, async (c) => {
    const bot = await loadBot(c);
    const symbol = c.req.param('symbol');
    const position = await repo.getPosition(bot.id, symbol);
    if (!position) throw new HttpError(404, 'Aucune position ouverte sur ce titre');
    const quote = await getQuote(symbol);
    if (!quote.marketOpen) throw new HttpError(409, 'Le marché est fermé : impossible de vendre maintenant.');
    await sell(repo, bot, position, quote.price, 'manual', 'Vente manuelle depuis le dashboard', Date.now());
    return c.json(await botDetail(bot.id));
  });

  api.get('/bots/:id/trades', async (c) => {
    const bot = await loadBot(c);
    return c.json(await repo.listTrades(bot.id, c.req.query('symbol') || undefined));
  });

  api.get('/bots/:id/trades.csv', async (c) => {
    const bot = await loadBot(c);
    const trades = (await repo.listTrades(bot.id)).reverse();
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Symbole', 'Sens', 'Quantité', 'Prix', 'Frais', 'Montant', 'Résultat', 'Résultat %', 'Déclencheur', 'Raison', 'Liquidités après'];
    const lines = trades.map((t) =>
      [
        new Date(t.time).toISOString(),
        t.symbol,
        t.side === 'BUY' ? 'ACHAT' : 'VENTE',
        t.qty,
        t.price.toFixed(4),
        t.fees.toFixed(2),
        t.amount.toFixed(2),
        t.pnl?.toFixed(2) ?? '',
        t.pnlPct?.toFixed(2) ?? '',
        t.trigger,
        t.reason,
        t.cashAfter.toFixed(2),
      ]
        .map(esc)
        .join(';'),
    );
    const filename = `trades-${bot.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    return c.body('﻿' + [header.join(';'), ...lines].join('\n'), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
  });

  api.get('/bots/:id/equity', async (c) => {
    const bot = await loadBot(c);
    return c.json(downsample(await repo.listEquity(bot.id), 1500));
  });

  api.get('/bots/:id/logs', async (c) => {
    const bot = await loadBot(c);
    const limit = Math.min(1000, Math.max(1, Number(c.req.query('limit') ?? 200) || 200));
    const levelsParam = c.req.query('levels');
    const levels = levelsParam ? (levelsParam.split(',') as LogLevel[]) : undefined;
    return c.json(await repo.listLogs(bot.id, limit, levels));
  });

  api.get('/bots/:id/chart', async (c) => {
    const bot = await loadBot(c);
    const symbol = c.req.query('symbol') ?? bot.symbols[0];
    if (!bot.symbols.includes(symbol)) throw new HttpError(400, 'Ce symbole ne fait pas partie du bot');
    const strategy = getStrategy(bot.strategy);
    const range = rangeFor(bot.interval, Math.max(strategy.warmup(bot.params) + 5, DISPLAY_BARS));
    let data;
    try {
      data = await getChart(symbol, bot.interval, range);
    } catch (err) {
      if (err instanceof MarketDataError) throw new HttpError(502, err.message);
      throw err;
    }
    // Les indicateurs sont calculés sur tout l'historique, puis on n'envoie que les dernières bougies (données plus légères).
    const series = strategy.compute(data.bars, bot.params);
    const from = Math.max(0, data.bars.length - MAX_CHART_BARS);
    const body: ChartResponse = {
      quote: data.quote,
      interval: bot.interval,
      bars: data.bars.slice(from),
      overlays: strategy.overlays(bot.params),
      series: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, v.slice(from)])),
      trades: await repo.listTrades(bot.id, symbol),
    };
    return c.json(body);
  });

  // --- Backtest ------------------------------------------------------------

  api.post('/backtest', async (c) => {
    const input = await parseBody(c, backtestSchema);
    if (!RANGES[input.interval].includes(input.range))
      throw new HttpError(400, `Période non disponible pour des bougies de ${INTERVAL_LABELS[input.interval]}`);
    const { cfg, currency } = await prepareConfig(input);
    const charts = await Promise.all(
      cfg.symbols.map(async (s) => {
        try {
          return (await getChart(s, cfg.interval, cfg.range)).bars;
        } catch (err) {
          if (err instanceof MarketDataError) throw new HttpError(502, `${s} : ${err.message}`);
          throw err;
        }
      }),
    );
    const barsBySymbol = Object.fromEntries(cfg.symbols.map((s, i) => [s, charts[i]]));
    let result;
    try {
      result = runBacktest(cfg, barsBySymbol);
    } catch (err) {
      if (err instanceof BacktestError) throw new HttpError(400, err.message);
      throw err;
    }
    const strategy = getStrategy(cfg.strategy);
    const body: BacktestResult = {
      ...result,
      currency,
      range: cfg.range,
      overlays: strategy.overlays(cfg.params),
      charts: Object.fromEntries(cfg.symbols.map((s) => [s, { bars: barsBySymbol[s], series: strategy.compute(barsBySymbol[s], cfg.params) }])),
    };
    return c.json(body);
  });

  // --- Planificateur du cloud ---------------------------------------------

  /** Appelée chaque minute par le planificateur (pg_cron sur Supabase) : analyse tous les bots. */
  api.post('/cron/tick', async (c) => {
    const expected = deps.cronSecret ? await deps.cronSecret() : null;
    if (!expected || !sameSecret(c.req.header('x-cron-secret') ?? '', expected)) throw new HttpError(403, 'Accès refusé');
    return c.json(await tickAllBots(repo));
  });

  // --- Gestion des erreurs -------------------------------------------------

  api.notFound((c) => c.json({ error: 'Route inconnue' }, 404));
  api.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: 'Erreur interne du serveur' }, 500);
  });

  return api;
}
