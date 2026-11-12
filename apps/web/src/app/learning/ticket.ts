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
  if (!draft.symbol) errors.push('Choisissez un actif.');
  if (!/^\d+$/.test(draft.quantity) || Number(draft.quantity) < 1) errors.push('Saisissez un nombre entier de titres (au moins 1).');
  if (draft.type !== 'MARKET' && (!PRICE_PATTERN.test(draft.price) || Number(draft.price) <= 0)) errors.push('Saisissez un cours avec au plus 3 décimales.');
  if (draft.type === 'STOP' && draft.side !== 'SELL') errors.push('Les ordres stop protègent des positions détenues : ils ne peuvent que vendre.');
  if (!draft.rationale) errors.push('Indiquez pourquoi vous passez cet ordre.');
  if (rules.requireConfidence && !draft.confidence) errors.push('Indiquez votre degré de confiance. Cette mission le demande à chaque ordre.');
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
