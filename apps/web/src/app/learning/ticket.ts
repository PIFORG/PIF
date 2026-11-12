import type { OrderSide, OrderType, PlaceOrderCommand, Rationale, SessionState } from '../core/api/learning-api';

/** apps/web/src/components/learning/ticket.ts */

export interface TicketDraft {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price: string;
  rationale: Rationale | '';
  confidence: string;
}

const PRICE_PATTERN = /^\d+(\.\d{1,3})?$/;

/**
 * Checks that the form is filled in correctly. Cash, holdings, limits, fees and warnings come
 * from the server's pre-trade preview, which runs the same checks as placing the order.
 */
export function ticketFormErrors(draft: TicketDraft, rules: { requireConfidence?: boolean }): string[] {
  const errors: string[] = [];
  if (!draft.symbol) errors.push('Choose an asset.');
  if (!/^\d+$/.test(draft.quantity) || Number(draft.quantity) < 1) errors.push('Enter a whole number of shares (at least 1).');
  if (draft.type !== 'MARKET' && (!PRICE_PATTERN.test(draft.price) || Number(draft.price) <= 0)) errors.push('Enter a price with at most 3 decimals.');
  if (draft.type === 'STOP' && draft.side !== 'SELL') errors.push('Stop orders protect positions you hold, so they can only sell.');
  if (!draft.rationale) errors.push('Say why you are placing this order.');
  if (rules.requireConfidence && !draft.confidence) errors.push('Rate how confident you are. This mission asks on every order.');
  return errors;
}

export function toCommand(draft: TicketDraft): PlaceOrderCommand {
  return {
    type: 'PLACE_ORDER',
    symbol: draft.symbol,
    side: draft.side,
    orderType: draft.type,
    quantity: Number(draft.quantity),
    ...(draft.type === 'LIMIT' ? { limitPrice: Number(draft.price) } : {}),
    ...(draft.type === 'STOP' ? { stopPrice: Number(draft.price) } : {}),
    rationale: draft.rationale as Rationale,
    ...(draft.confidence ? { confidence: Number(draft.confidence) } : {}),
  };
}

export function emptyDraft(state: SessionState): TicketDraft {
  return { symbol: state.quotes[0]?.symbol ?? '', side: 'BUY', type: 'MARKET', quantity: '', price: '', rationale: '', confidence: '' };
}
