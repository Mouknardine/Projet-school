// Règles de calcul communes au bot en direct et au backtest :
// taille des ordres, frais, résultat d'une vente, niveaux de stop-loss / take-profit.

export interface SizingInput {
  cash: number;
  equity: number;
  price: number;
  positionSizePct: number;
  feePct: number;
  allowFractional: boolean;
}

export interface BuyOrder {
  qty: number;
  gross: number;
  fees: number;
  /** Montant total débité (prix × quantité + frais). */
  total: number;
}

/** Montant minimum d'un ordre, pour éviter des ordres absurdes de quelques centimes. */
export const MIN_ORDER_VALUE = 1;

/**
 * Calcule combien d'actions acheter : on investit `positionSizePct` % de la valeur totale du portefeuille,
 * sans jamais dépasser le cash disponible, frais compris.
 * Renvoie null si le budget ne permet pas d'acheter (ex. moins d'une action entière).
 */
export function sizeBuy(input: SizingInput): BuyOrder | null {
  const { cash, equity, price, positionSizePct, feePct, allowFractional } = input;
  if (price <= 0 || cash <= 0) return null;
  const budget = Math.min((equity * positionSizePct) / 100, cash);
  const raw = budget / (price * (1 + feePct / 100));
  const qty = allowFractional ? Math.floor(raw * 10_000) / 10_000 : Math.floor(raw);
  const gross = qty * price;
  if (qty <= 0 || gross < MIN_ORDER_VALUE) return null;
  const fees = (gross * feePct) / 100;
  return { qty, gross, fees, total: gross + fees };
}

export interface SellResult {
  gross: number;
  fees: number;
  /** Montant crédité sur le cash (prix × quantité − frais). */
  proceeds: number;
  /** Gain ou perte réalisé, frais d'achat et de vente compris. */
  pnl: number;
  pnlPct: number;
}

/** Calcule le résultat de la vente complète d'une position. */
export function computeSell(qty: number, price: number, costBasis: number, feePct: number): SellResult {
  const gross = qty * price;
  const fees = (gross * feePct) / 100;
  const proceeds = gross - fees;
  const pnl = proceeds - costBasis;
  return { gross, fees, proceeds, pnl, pnlPct: costBasis > 0 ? (pnl / costBasis) * 100 : 0 };
}

export function stopLossPrice(entryPrice: number, stopLossPct: number): number | null {
  return stopLossPct > 0 ? entryPrice * (1 - stopLossPct / 100) : null;
}

export function takeProfitPrice(entryPrice: number, takeProfitPct: number): number | null {
  return takeProfitPct > 0 ? entryPrice * (1 + takeProfitPct / 100) : null;
}
