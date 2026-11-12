import type { OrderTerms, TradeOrderType, TradeSide } from '../core/api/trading-api';

/** apps/web/src/components/trading/ticketDraft.ts. What the user has typed; prices and quantities stay strings until validated. */
export interface TicketDraft {
  symbol: string;
  side: TradeSide;
  type: TradeOrderType;
  quantity: string;
  limitPrice: string;
  stopPrice: string;
}

export type TicketErrors = Partial<Record<'symbol' | 'quantity' | 'limitPrice' | 'stopPrice' | 'type', string>>;

export function emptyTicket(symbol = ''): TicketDraft {
  return { symbol, side: 'BUY', type: 'MARKET', quantity: '', limitPrice: '', stopPrice: '' };
}

const PRICE = /^\d+(\.\d{1,3})?$/;

function priceError(value: string, label: string): string | null {
  const text = value.trim();
  if (!text) return `Saisissez un ${label}.`;
  if (!PRICE.test(text) || Number(text) <= 0) return `Le ${label} doit être un montant positif en DT, avec au plus 3 décimales.`;
  return null;
}

/**
 * Format checks only, so the user gets immediate guidance. Cash, holdings, limits and market rules
 * are checked by the server preview, which is the only source of truth.
 */
export function ticketErrors(draft: TicketDraft, lotSize = 1): TicketErrors {
  const errors: TicketErrors = {};
  if (!draft.symbol) errors.symbol = 'Choisissez un instrument.';
  const quantity = draft.quantity.trim();
  if (!/^\d+$/.test(quantity) || Number(quantity) < 1) errors.quantity = "Saisissez un nombre entier d'unités, au moins 1.";
  else if (Number(quantity) > 1_000_000) errors.quantity = 'La quantité ne peut pas dépasser 1 000 000.';
  else if (Number(quantity) % lotSize !== 0) errors.quantity = `La quantité doit être un multiple de la taille de lot (${lotSize}).`;
  if (draft.type === 'LIMIT') {
    const error = priceError(draft.limitPrice, 'cours limite');
    if (error) errors.limitPrice = error;
  }
  if (draft.type === 'STOP') {
    if (draft.side === 'BUY') errors.type = 'Les ordres stop sont des ventes de protection. Choisissez Vendre, ou un ordre à cours limité pour acheter.';
    const error = priceError(draft.stopPrice, 'cours stop');
    if (error) errors.stopPrice = error;
  }
  return errors;
}

export function toOrderTerms(draft: TicketDraft): OrderTerms {
  const terms: OrderTerms = { symbol: draft.symbol, side: draft.side, type: draft.type, quantity: Number(draft.quantity.trim()) };
  if (draft.type === 'LIMIT') terms.limitPrice = Number(draft.limitPrice.trim());
  if (draft.type === 'STOP') terms.stopPrice = Number(draft.stopPrice.trim());
  return terms;
}

/** Stable key for "the same order", so a preview is only reused for exactly the terms it checked. */
export function termsKey(terms: OrderTerms): string {
  return JSON.stringify([terms.symbol, terms.side, terms.type, terms.quantity, terms.limitPrice ?? null, terms.stopPrice ?? null]);
}
