// Routes de l'API REST utilisées par le dashboard.

import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
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
import { config } from './config.ts';
import * as repo from './db.ts';
import { getChart, getQuote, MarketDataError, RANGE_LABELS, RANGES, rangeFor, searchSymbols } from './market/yahoo.ts';
import { BacktestError, runBacktest } from './trading/backtest.ts';
import { sell, tickBot } from './trading/engine.ts';
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

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
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

/** Si un mot de passe administrateur est configuré, il est exigé pour toute modification. */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!config.adminPassword) return next();
  const given = String(req.header('x-admin-password') ?? '');
  const hash = (s: string) => crypto.createHash('sha256').update(s).digest();
  if (crypto.timingSafeEqual(hash(given), hash(config.adminPassword))) return next();
  res.status(401).json({ error: 'Mot de passe administrateur requis ou incorrect.', authRequired: true });
}

function loadBot(req: Request) {
  const bot = repo.getBot(Number(req.params.id));
  if (!bot) throw new HttpError(404, 'Bot introuvable');
  return bot;
}

function botDetail(id: number): BotDetail {
  const bot = repo.getBot(id);
  if (!bot) throw new HttpError(404, 'Bot introuvable');
  const positions = positionsView(bot);
  const state = repo.getBotState(id);
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
  return { bot, summary: computeSummary(bot, positions), positions, strategy: getStrategy(bot.strategy).info, watchlist };
}

/** Nombre de bougies affichées au minimum sur le graphique d'un bot. */
const DISPLAY_BARS = 300;

export const api = express.Router();

api.get('/config', (_req, res) => {
  const body: AppConfig = {
    authRequired: !!config.adminPassword,
    tickSeconds: config.tickSeconds,
    intervals: INTERVALS.map((id) => ({
      id,
      label: INTERVAL_LABELS[id],
      backtestRanges: RANGES[id].map((r) => ({ id: r, label: RANGE_LABELS[r] })),
    })),
  };
  res.json(body);
});

api.post('/auth/check', requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

api.get('/strategies', (_req, res) => {
  res.json(Object.values(STRATEGIES).map((s) => s.info));
});

// --- Données de marché -----------------------------------------------------

api.get('/market/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 1) return res.json([]);
  try {
    res.json(await searchSymbols(q));
  } catch (err) {
    if (err instanceof MarketDataError) throw new HttpError(502, err.message);
    throw err;
  }
});

api.get('/market/quote/:symbol', async (req, res) => {
  try {
    res.json(await getQuote(String(req.params.symbol).toUpperCase()));
  } catch (err) {
    if (err instanceof MarketDataError) throw new HttpError(404, err.message);
    throw err;
  }
});

// --- Bots ------------------------------------------------------------------

api.get('/bots', (_req, res) => {
  const items: BotListItem[] = repo.listBots().map((bot) => ({ bot, summary: computeSummary(bot) }));
  res.json(items);
});

api.post('/bots', requireAdmin, async (req, res) => {
  const input = parse(createBotSchema, req.body);
  const { cfg, quotes, currency } = await prepareConfig(input);
  const startPrices = Object.fromEntries(cfg.symbols.map((s, i) => [s, quotes[i].price]));
  const id = repo.insertBot(cfg, currency, startPrices, Date.now());
  const strategy = getStrategy(cfg.strategy);
  repo.insertLog(
    id,
    'info',
    null,
    `Bot créé avec ${cfg.initialCapital.toFixed(2)} ${currency} — stratégie « ${strategy.info.name} », bougies de ${INTERVAL_LABELS[cfg.interval]}, actions suivies : ${cfg.symbols.join(', ')}`,
  );
  await tickBot(id, { force: true });
  res.status(201).json(botDetail(id));
});

api.get('/bots/:id', (req, res) => {
  res.json(botDetail(loadBot(req).id));
});

api.patch('/bots/:id', requireAdmin, (req, res) => {
  const bot = loadBot(req);
  const body = parse(patchBotSchema, req.body);
  if (body.name) repo.setBotName(bot.id, body.name);
  if (body.status && body.status !== bot.status) {
    repo.setBotStatus(bot.id, body.status);
    repo.insertLog(bot.id, 'info', null, body.status === 'paused' ? 'Bot mis en pause : plus aucun ordre ne sera passé' : 'Bot relancé');
  }
  res.json(botDetail(bot.id));
});

api.post('/bots/:id/tick', requireAdmin, async (req, res) => {
  const bot = loadBot(req);
  await tickBot(bot.id, { force: true });
  res.json(botDetail(bot.id));
});

api.post('/bots/:id/reset', requireAdmin, async (req, res) => {
  const bot = loadBot(req);
  const { quotes } = await prepareConfig(bot);
  const startPrices = Object.fromEntries(bot.symbols.map((s, i) => [s, quotes[i].price]));
  repo.resetBot(bot.id, startPrices, Date.now());
  repo.insertLog(bot.id, 'info', null, `Bot réinitialisé avec ${bot.initialCapital.toFixed(2)} ${bot.currency}`);
  await tickBot(bot.id, { force: true });
  res.json(botDetail(bot.id));
});

api.delete('/bots/:id', requireAdmin, (req, res) => {
  repo.deleteBot(loadBot(req).id);
  res.status(204).end();
});

/** Vente manuelle d'une position, au cours actuel (uniquement si le marché est ouvert). */
api.post('/bots/:id/positions/:symbol/close', requireAdmin, async (req, res) => {
  const bot = loadBot(req);
  const symbol = String(req.params.symbol);
  const position = repo.getPosition(bot.id, symbol);
  if (!position) throw new HttpError(404, 'Aucune position ouverte sur ce titre');
  const quote = await getQuote(symbol);
  if (!quote.marketOpen) throw new HttpError(409, 'Le marché est fermé : impossible de vendre maintenant.');
  sell(bot, position, quote.price, 'manual', 'Vente manuelle depuis le dashboard', Date.now());
  res.json(botDetail(bot.id));
});

api.get('/bots/:id/trades', (req, res) => {
  const bot = loadBot(req);
  const symbol = req.query.symbol ? String(req.query.symbol) : undefined;
  res.json(repo.listTrades(bot.id, symbol));
});

api.get('/bots/:id/trades.csv', (req, res) => {
  const bot = loadBot(req);
  const trades = repo.listTrades(bot.id).reverse();
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
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + [header.join(';'), ...lines].join('\n'));
});

api.get('/bots/:id/equity', (req, res) => {
  const bot = loadBot(req);
  res.json(downsample(repo.listEquity(bot.id), 1500));
});

api.get('/bots/:id/logs', (req, res) => {
  const bot = loadBot(req);
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit ?? 200)));
  const levels = req.query.levels ? (String(req.query.levels).split(',') as LogLevel[]) : undefined;
  res.json(repo.listLogs(bot.id, limit, levels));
});

api.get('/bots/:id/chart', async (req, res) => {
  const bot = loadBot(req);
  const symbol = String(req.query.symbol ?? bot.symbols[0]);
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
  const body: ChartResponse = {
    quote: data.quote,
    interval: bot.interval,
    bars: data.bars,
    overlays: strategy.overlays(bot.params),
    series: strategy.compute(data.bars, bot.params),
    trades: repo.listTrades(bot.id, symbol),
  };
  res.json(body);
});

// --- Backtest --------------------------------------------------------------

api.post('/backtest', async (req, res) => {
  const input = parse(backtestSchema, req.body);
  if (!RANGES[input.interval].includes(input.range))
    throw new HttpError(400, `Période non disponible pour des bougies de ${INTERVAL_LABELS[input.interval]}`);
  const { cfg, currency } = await prepareConfig(input);
  const barsBySymbol: Record<string, Awaited<ReturnType<typeof getChart>>['bars']> = {};
  for (const s of cfg.symbols) {
    try {
      barsBySymbol[s] = (await getChart(s, cfg.interval, cfg.range)).bars;
    } catch (err) {
      if (err instanceof MarketDataError) throw new HttpError(502, `${s} : ${err.message}`);
      throw err;
    }
  }
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
    charts: Object.fromEntries(
      cfg.symbols.map((s) => [s, { bars: barsBySymbol[s], series: strategy.compute(barsBySymbol[s], cfg.params) }]),
    ),
  };
  res.json(body);
});

// --- Gestion des erreurs ---------------------------------------------------

api.use((_req, _res) => {
  throw new HttpError(404, 'Route inconnue');
});

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'Requête JSON invalide' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
}
