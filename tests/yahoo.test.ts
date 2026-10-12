import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closedBars, MarketDataError, parseChart, rangeFor } from '../server/market/yahoo.ts';

// Structure d'une réponse de l'API « chart » de Yahoo Finance (v8).
function chartResponse(opts: { now: number; timestamps: number[]; closes: (number | null)[]; regularMarketTime: number }) {
  const { timestamps, closes } = opts;
  return {
    chart: {
      result: [
        {
          meta: {
            currency: 'USD',
            symbol: 'AAPL',
            exchangeName: 'NMS',
            fullExchangeName: 'NasdaqGS',
            longName: 'Apple Inc.',
            regularMarketPrice: 231.5,
            regularMarketTime: opts.regularMarketTime,
            chartPreviousClose: 225,
            gmtoffset: -14400,
            currentTradingPeriod: {
              regular: { start: Math.floor(opts.now / 1000) - 3600, end: Math.floor(opts.now / 1000) + 3600 },
            },
          },
          timestamp: timestamps,
          indicators: {
            quote: [
              {
                open: closes.map((c) => (c === null ? null : c - 0.5)),
                high: closes.map((c) => (c === null ? null : c + 1)),
                low: closes.map((c) => (c === null ? null : c - 1)),
                close: closes,
                volume: closes.map(() => 1000),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

describe('données Yahoo Finance', () => {
  const now = Date.UTC(2025, 5, 10, 15, 0); // mardi 11 h à New York
  const t0 = now / 1000 - 3 * 300;

  it('transforme la réponse en bougies et ignore les points vides', () => {
    const json = chartResponse({ now, timestamps: [t0, t0 + 300, t0 + 600, t0 + 900], closes: [230, null, 231, 231.5], regularMarketTime: now / 1000 - 10 });
    const { quote, bars } = parseChart(json, now);
    assert.equal(bars.length, 3);
    assert.equal(bars[0].time, t0 * 1000);
    assert.equal(quote.price, 231.5);
    assert.equal(quote.name, 'Apple Inc.');
    assert.equal(quote.marketOpen, true);
  });

  it('considère le marché fermé si le cours n’est plus mis à jour', () => {
    const json = chartResponse({ now, timestamps: [t0], closes: [230], regularMarketTime: now / 1000 - 2 * 3600 });
    assert.equal(parseChart(json, now).quote.marketOpen, false);
  });

  it('signale un symbole inconnu', () => {
    const json = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };
    assert.throws(() => parseChart(json), MarketDataError);
  });

  it('écarte la bougie en cours de formation quand le marché est ouvert', () => {
    const json = chartResponse({ now, timestamps: [t0, t0 + 300, t0 + 600, t0 + 900], closes: [1, 2, 3, 4], regularMarketTime: now / 1000 });
    const { bars } = parseChart(json, now);
    // La dernière bougie a démarré à now − 0 s : elle n'est pas terminée.
    assert.equal(closedBars(bars, '5m', true, now).length, 3);
    assert.equal(closedBars(bars, '5m', false, now).length, 4);
  });

  it('choisit une plage d’historique suffisante', () => {
    assert.equal(rangeFor('1d', 60), '6mo');
    assert.equal(rangeFor('1d', 200), '1y');
    assert.equal(rangeFor('1d', 210), '2y');
    assert.equal(rangeFor('5m', 60), '5d');
  });
});
