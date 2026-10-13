// Routes de l'API REST utilisées par le dashboard.
// Écrite avec Hono, qui fonctionne aussi bien sous Node.js (serveur local) que sous Deno (Supabase Edge Functions).

import crypto from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import {
  ACCOUNT_CURRENCIES,
  type AppConfig,
  type BacktestResult,
  type Bar,
  type BotConfig,
  type BrokerId,
  type BotDetail,
  type BotListItem,
  type ChartResponse,
  type CostPreview,
  type CostPreviewItem,
  type Interval,
  type LogLevel,
  type Quote,
  type RiskLevel,
  type StrategyId,
} from '../shared/types.ts';
import { fxAt, getFxHistory, getFxRate } from './market/fx.ts';
import { measureAssets } from './market/risk.ts';
import { candidatePool, configFromProfile, pickAssets, type AssetSuggestion, type ProfileSimulation } from '../shared/profile.ts';
import { getChart, getQuote, MarketDataError, RANGE_LABELS, RANGES, rangeFor, searchSymbols } from './market/yahoo.ts';
import type { Repo } from './repo.ts';
import { BacktestError, runBacktest } from './trading/backtest.ts';
import { BROKER_IDS, BROKER_LIST, brokerName, costsSummary, fractionalAllowed, orderCosts } from './trading/costs.ts';
import { currentEquity, sell, tickAllBots, tickBot } from './trading/engine.ts';
import { sizeOrder } from './trading/portfolio.ts';
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
  /** Devise du compte. Par défaut : la devise des actions si elles en ont toutes une seule, sinon le franc suisse. */
  currency: z.enum(ACCOUNT_CURRENCIES).optional(),
  broker: z.enum(BROKER_IDS as [BrokerId, ...BrokerId[]]).optional().default('simple'),
  maxLossPct: z.number().min(0).max(90).optional().default(0),
  profile: z
    .object({
      level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
      answers: z.record(z.string().max(40), z.string().max(200)),
      volatility: z.record(z.string().max(20), z.number()),
    })
    .nullable()
    .optional()
    .default(null),
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
async function prepareConfig<T extends Omit<BotConfig, 'name' | 'currency'> & { currency?: string }>(
  input: T,
): Promise<{ cfg: T & { currency: string }; quotes: Quote[]; startFx: Record<string, number> }> {
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
  // Les actions peuvent venir de plusieurs bourses (USD, CHF, EUR…) : chaque achat est converti au vrai taux de change.
  const currencies = [...new Set(quotes.map((q) => q.currency))];
  const single = currencies.length === 1 && (ACCOUNT_CURRENCIES as readonly string[]).includes(currencies[0]) ? currencies[0] : null;
  const currency = input.currency ?? single ?? 'CHF';
  const rates = await Promise.all(
    currencies.map(async (c) => {
      try {
        return await getFxRate(c, currency);
      } catch (err) {
        if (err instanceof MarketDataError) throw new HttpError(400, err.message);
        throw err;
      }
    }),
  );
  const fxOf = Object.fromEntries(currencies.map((c, i) => [c, rates[i]]));
  const startFx = Object.fromEntries(symbols.map((s, i) => [s, fxOf[quotes[i].currency]]));
  return { cfg: { ...input, params, symbols, currency }, quotes, startFx };
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
        currency: state.currency[symbol] ?? null,
        fx: state.fx[symbol] ?? null,
        lastAnalysis: state.lastAnalysis[symbol] ?? null,
        session: state.session[symbol] ?? null,
      };
    });
    const lossFloor = bot.maxLossPct > 0 ? (state.floorBase ?? bot.initialCapital) * (1 - bot.maxLossPct / 100) : null;
    return {
      bot,
      summary: await computeSummary(repo, bot, positions),
      positions,
      strategy: getStrategy(bot.strategy).info,
      watchlist,
      lossFloor,
      protection: state.protection ?? null,
    };
  };

  api.get('/config', async (c) => {
    const body: AppConfig = {
      authRequired: !!(await deps.adminPassword()),
      tickSeconds: deps.tickSeconds,
      brokers: BROKER_LIST,
      accountCurrencies: [...ACCOUNT_CURRENCIES],
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

  // Choix des placements pour un profil : le bot mesure l'agitation de chaque action sur un an et prend celles qui correspondent.
  const assetsSchema = z.object({
    level: z.coerce.number().int().min(1).max(5),
    region: z.enum(['ch', 'world', 'tech', 'any']),
    crypto: z.enum(['0', '1']).optional().default('0'),
    favorites: z.string().max(200).optional().default(''),
    currency: z.enum(ACCOUNT_CURRENCIES).optional().default('CHF'),
  });
  api.get('/profile/assets', async (c) => {
    const parsed = assetsSchema.safeParse(c.req.query());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join(' ; '));
    const level = parsed.data.level as RiskLevel;
    const favorites = [...new Set(parsed.data.favorites.toUpperCase().split(','))].filter((s) => /^[A-Z0-9.\-=^]{1,20}$/.test(s)).slice(0, 3);
    const currency = parsed.data.currency;
    const pool = candidatePool(parsed.data.region, parsed.data.crypto === '1' && level >= 4, { level, currency }).map((x) => x.symbol);
    const symbols = [...new Set([...favorites, ...pool])];
    const { measured, errors } = await measureAssets(symbols, { accountCurrency: currency });
    const body: AssetSuggestion = { picked: pickAssets(level, measured, favorites), analysed: measured.length, errors };
    return c.json(body);
  });

  // Simulation honnête d'un profil : le bot se place il y a quelques années, choisit ses placements avec les seuls cours
  // connus à ce moment-là (l'année d'avant), puis on rejoue ce qui s'est passé ensuite. Aucune information du futur.
  const simulateSchema = z.object({
    level: z.number().int().min(1).max(5),
    maxLossPct: z.number().min(0).max(90),
    region: z.enum(['ch', 'world', 'tech', 'any']),
    crypto: z.boolean().optional().default(false),
    favorites: z.array(z.string().max(20)).max(3).optional().default([]),
    exclude: z.array(z.string().max(20)).max(60).optional().default([]),
    years: z.number().int().min(1).max(4).optional().default(2),
    capital: z.number().min(100).max(100_000_000),
    currency: z.enum(ACCOUNT_CURRENCIES),
    broker: z.string().max(20),
    /** Pour comparer : une autre stratégie que celle du profil (utilisé pour les tests de la page « Comprendre »). */
    strategy: z.enum(STRATEGY_IDS as [StrategyId, ...StrategyId[]]).optional(),
    params: z.record(z.string(), z.number()).optional(),
  });
  api.post('/profile/simulate', async (c) => {
    const input = await parseBody(c, simulateSchema);
    const level = input.level as RiskLevel;
    const start = Date.now() - input.years * 365 * 86_400_000;
    const valid = (s: string) => /^[A-Z0-9.\-=^]{1,20}$/.test(s);
    const favorites = [...new Set(input.favorites.map((s) => s.toUpperCase()))].filter(valid).slice(0, 3);
    const exclude = new Set(input.exclude.map((s) => s.toUpperCase()));
    const pool = [...new Set([...favorites, ...candidatePool(input.region, input.crypto && level >= 4, { level, currency: input.currency }).map((x) => x.symbol)])].filter(
      (s) => !exclude.has(s),
    );

    // 1. Ce que le bot aurait choisi à la date de départ, avec les cours de l'année d'avant uniquement (en monnaie du compte).
    const { measured } = await measureAssets(pool, { asOf: start, accountCurrency: input.currency });
    const picked = pickAssets(level, measured, favorites);
    if (picked.length === 0) throw new HttpError(400, "Pas assez d'historique de cours pour simuler ce profil.");

    // 2. Les réglages du bot pour ce profil (ou une autre stratégie, pour comparer).
    const base = configFromProfile({
      result: { level, maxLossPct: input.maxLossPct },
      answers: {},
      symbols: picked.map((p) => p.symbol),
      volatility: {},
      capital: input.capital,
      currency: input.currency,
      broker: input.broker,
    });
    const strategyId = input.strategy ?? base.strategy;
    const cfg = { ...base, strategy: strategyId, params: input.strategy ? normalizeParams(strategyId, input.params) : base.params, profile: null };
    const warmup = getStrategy(cfg.strategy).warmup(cfg.params);

    // 3. Les cours à partir de la date de départ (plus l'historique nécessaire aux calculs de la stratégie).
    const charts = await Promise.all(cfg.symbols.map((s) => getChart(s, '1d', '5y')));
    const barsBySymbol: Record<string, Bar[]> = {};
    const currencyOf: Record<string, string> = {};
    cfg.symbols.forEach((s, i) => {
      const bars = charts[i].bars;
      const first = bars.findIndex((b) => b.time >= start);
      barsBySymbol[s] = first < 0 ? [] : bars.slice(Math.max(0, first - (warmup - 1)));
      currencyOf[s] = charts[i].quote.currency;
    });
    const fxHistories = new Map<string, Bar[]>();
    const fxNow = new Map<string, number>();
    for (const cur of new Set(Object.values(currencyOf))) {
      if (cur === cfg.currency) continue;
      try {
        fxHistories.set(cur, await getFxHistory(cur, cfg.currency, '1d', '5y'));
        fxNow.set(cur, await getFxRate(cur, cfg.currency));
      } catch (err) {
        if (err instanceof MarketDataError) throw new HttpError(502, `Taux de change ${cur} → ${cfg.currency} : ${err.message}`);
        throw err;
      }
    }
    const fxBySymbol = Object.fromEntries(cfg.symbols.map((s) => [s, fxAt(fxHistories.get(currencyOf[s]) ?? [], fxNow.get(currencyOf[s]) ?? 1)]));
    let result;
    try {
      result = runBacktest(cfg, barsBySymbol, { currencyOf, fxBySymbol });
    } catch (err) {
      if (err instanceof BacktestError) throw new HttpError(400, err.message);
      throw err;
    }
    const body: ProfileSimulation = {
      startTime: start,
      years: input.years,
      picked,
      analysed: measured.length,
      result: { ...result, currency: cfg.currency, range: `${input.years}y` },
    };
    return c.json(body);
  });

  // Aperçu des frais réels : ce que coûterait aujourd'hui un achat (puis sa revente) de chaque action choisie.
  const previewSchema = z.object({
    broker: z.enum(BROKER_IDS as [BrokerId, ...BrokerId[]]),
    currency: z.enum(ACCOUNT_CURRENCIES),
    amount: z.coerce.number().min(1).max(100_000_000),
    feePct: z.coerce.number().min(0).max(5).optional().default(0),
    fractional: z.enum(['0', '1']).optional().default('1'),
    symbols: z.string().trim().min(1).max(250),
  });
  api.get('/costs/preview', async (c) => {
    const parsed = previewSchema.safeParse(c.req.query());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join(' ; '));
    const { broker, currency, amount, feePct } = parsed.data;
    const symbols = [...new Set(parsed.data.symbols.toUpperCase().split(','))].filter((s) => /^[A-Z0-9.\-=^]{1,20}$/.test(s)).slice(0, 10);
    const now = Date.now();
    const settled = await Promise.allSettled(
      symbols.map(async (symbol): Promise<CostPreviewItem | string> => {
        const quote = await getQuote(symbol);
        const fxRate = await getFxRate(quote.currency, currency);
        const base = { broker, symbol, price: quote.price, quoteCurrency: quote.currency, accountCurrency: currency, fxRate, feePct, time: now };
        const order = sizeOrder({
          budget: amount,
          unitCost: quote.price * fxRate,
          fractional: fractionalAllowed(broker, symbol, parsed.data.fractional === '1'),
          costOf: (qty) => orderCosts({ ...base, side: 'BUY', qty }).total,
        });
        if (!order) return `${symbol} : une seule action coûte plus que ${amount.toFixed(0)} ${currency}, frais compris`;
        const buy = orderCosts({ ...base, side: 'BUY', qty: order.qty });
        const sellCosts = orderCosts({ ...base, side: 'SELL', qty: order.qty });
        return {
          symbol,
          name: quote.name,
          currency: quote.currency,
          price: quote.price,
          fxRate,
          qty: order.qty,
          value: order.gross,
          buy: buy.lines,
          buyTotal: buy.total,
          sell: sellCosts.lines,
          sellTotal: sellCosts.total,
          breakEvenPct: ((buy.total + sellCosts.total) / order.gross) * 100,
        };
      }),
    );
    const body: CostPreview = { currency, amount, items: [], errors: [] };
    settled.forEach((r, i) => {
      if (r.status === 'rejected') body.errors.push(`${symbols[i]} : ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      else if (typeof r.value === 'string') body.errors.push(r.value);
      else body.items.push(r.value);
    });
    return c.json(body);
  });

  // --- Bots ----------------------------------------------------------------

  api.get('/bots', async (c) => {
    const bots = await repo.listBots();
    const items: BotListItem[] = [];
    for (const bot of bots) {
      const state = await repo.getBotState(bot.id);
      const seen = bot.symbols.map((s) => state.marketOpen[s]).filter((v) => v !== undefined);
      items.push({ bot, summary: await computeSummary(repo, bot), marketOpen: seen.length ? seen.some(Boolean) : null });
    }
    return c.json(items);
  });

  api.post('/bots', requireAdmin, async (c) => {
    const input = await parseBody(c, createBotSchema);
    const { cfg, quotes, startFx } = await prepareConfig(input);
    const startPrices = Object.fromEntries(cfg.symbols.map((s, i) => [s, quotes[i].price]));
    const id = await repo.insertBot(cfg, startPrices, startFx, Date.now());
    const strategy = getStrategy(cfg.strategy);
    await repo.insertLog(
      id,
      'info',
      null,
      `Bot créé avec ${cfg.initialCapital.toFixed(2)} ${cfg.currency} — stratégie « ${strategy.info.name} », bougies de ${INTERVAL_LABELS[cfg.interval]}, tarifs ${brokerName(cfg.broker)}, actions suivies : ${cfg.symbols.join(', ')}`,
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
      // Relance après la limite de perte : la limite repart de la valeur actuelle du placement.
      const state = await repo.getBotState(bot.id);
      if (body.status === 'running' && state.protection) {
        const equity = await currentEquity(repo, bot.id, bot.cash);
        state.protection = null;
        state.floorBase = equity;
        await repo.saveBotState(bot.id, state);
        const floor = equity * (1 - bot.maxLossPct / 100);
        await repo.insertLog(
          bot.id,
          'info',
          null,
          `Nouvelle limite de perte : le bot repart de ${equity.toFixed(2)} ${bot.currency} et vendra tout si le placement descend sous ${floor.toFixed(2)} ${bot.currency} (−${bot.maxLossPct} %).`,
        );
      }
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
    const { quotes, startFx } = await prepareConfig(bot);
    const startPrices = Object.fromEntries(bot.symbols.map((s, i) => [s, quotes[i].price]));
    await repo.resetBot(bot.id, startPrices, startFx, Date.now());
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
    const fx = await getFxRate(quote.currency, bot.currency);
    await sell(
      repo,
      bot,
      position,
      { price: quote.price, currency: quote.currency, fx },
      'manual',
      "Vente demandée à la main depuis le dashboard : ce n'est pas une décision du bot.",
      Date.now(),
    );
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
    const header = [
      'Date',
      'Symbole',
      'Sens',
      'Quantité',
      'Prix',
      'Devise de l’action',
      `Taux de change vers ${bot.currency}`,
      `Frais (${bot.currency})`,
      'Détail des frais',
      `Montant (${bot.currency})`,
      `Résultat (${bot.currency})`,
      'Résultat %',
      'Déclencheur',
      'Raison',
      `Liquidités après (${bot.currency})`,
    ];
    const lines = trades.map((t) =>
      [
        new Date(t.time).toISOString(),
        t.symbol,
        t.side === 'BUY' ? 'ACHAT' : 'VENTE',
        t.qty,
        t.price.toFixed(4),
        t.currency || bot.currency,
        t.fxRate.toFixed(6),
        t.fees.toFixed(2),
        t.costs ? costsSummary(t.costs, bot.currency) : '',
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
    const { cfg, quotes, startFx } = await prepareConfig(input);
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
    // Historique réel des taux de change sur la même période, pour convertir chaque achat et chaque vente à la bonne date.
    const currencyOf = Object.fromEntries(cfg.symbols.map((s, i) => [s, quotes[i].currency]));
    const fxHistories = new Map<string, Bar[]>();
    for (const c of new Set(Object.values(currencyOf))) {
      if (c === cfg.currency) continue;
      try {
        fxHistories.set(c, await getFxHistory(c, cfg.currency, cfg.interval, cfg.range));
      } catch (err) {
        if (err instanceof MarketDataError) throw new HttpError(502, `Taux de change ${c} → ${cfg.currency} : ${err.message}`);
        throw err;
      }
    }
    const fxBySymbol = Object.fromEntries(cfg.symbols.map((s) => [s, fxAt(fxHistories.get(currencyOf[s]) ?? [], startFx[s] ?? 1)]));
    let result;
    try {
      result = runBacktest(cfg, barsBySymbol, { currencyOf, fxBySymbol });
    } catch (err) {
      if (err instanceof BacktestError) throw new HttpError(400, err.message);
      throw err;
    }
    const strategy = getStrategy(cfg.strategy);
    const body: BacktestResult = {
      ...result,
      currency: cfg.currency,
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
