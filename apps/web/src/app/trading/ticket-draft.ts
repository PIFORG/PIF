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
  if (!text) return `Enter a ${label}.`;
  if (!PRICE.test(text) || Number(text) <= 0) return `The ${label} must be a positive amount in DT with at most 3 decimals.`;
  return null;
}

/**
 * Format checks only, so the user gets immediate guidance. Cash, holdings, limits and market rules
 * are checked by the server preview, which is the only source of truth.
 */
export function ticketErrors(draft: TicketDraft, lotSize = 1): TicketErrors {
  const errors: TicketErrors = {};
  if (!draft.symbol) errors.symbol = 'Choose an instrument.';
  const quantity = draft.quantity.trim();
  if (!/^\d+$/.test(quantity) || Number(quantity) < 1) errors.quantity = 'Enter a whole number of units, at least 1.';
  else if (Number(quantity) > 1_000_000) errors.quantity = 'The quantity can be at most 1,000,000.';
  else if (Number(quantity) % lotSize !== 0) errors.quantity = `The quantity must be a multiple of the lot size (${lotSize}).`;
  if (draft.type === 'LIMIT') {
    const error = priceError(draft.limitPrice, 'limit price');
    if (error) errors.limitPrice = error;
  }
  if (draft.type === 'STOP') {
    if (draft.side === 'BUY') errors.type = 'Stop orders are protective sells. Choose Sell, or use a limit order to buy.';
    const error = priceError(draft.stopPrice, 'stop price');
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
