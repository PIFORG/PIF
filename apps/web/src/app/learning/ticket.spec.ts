import type { SessionState } from '../core/api/learning-api';
import { emptyDraft, ticketFormErrors, toCommand, type TicketDraft } from './ticket';

const state = {
  quotes: [{ symbol: 'AAA', name: 'Alpha', sector: 'Tech', bid: 9.99, ask: 10.01, mid: 10, depth: 100, spreadBps: 20, changePct: 0 }],
} as unknown as SessionState;
const draft = (patch: Partial<TicketDraft>): TicketDraft => ({ ...emptyDraft(state), quantity: '10', rationale: 'LONG_TERM_VIEW', ...patch });

describe('order ticket form', () => {
  it('accepts a complete market order', () => {
    expect(ticketFormErrors(draft({}), {})).toEqual([]);
  });

  it('requires a reason, a whole quantity and a price with at most three decimals', () => {
    expect(ticketFormErrors(draft({ rationale: '', quantity: '1.5', type: 'LIMIT', price: '10.0001' }), {})).toEqual([
      'Enter a whole number of shares (at least 1).',
      'Enter a price with at most 3 decimals.',
      'Say why you are placing this order.',
    ]);
    expect(ticketFormErrors(draft({ quantity: '0' }), {})).toHaveLength(1);
    expect(ticketFormErrors(draft({ type: 'LIMIT', price: '9.875' }), {})).toEqual([]);
  });

  it('requires a confidence rating only in missions that ask for one', () => {
    expect(ticketFormErrors(draft({}), { requireConfidence: true })).toEqual(['Rate how confident you are. This mission asks on every order.']);
    expect(ticketFormErrors(draft({ confidence: '60' }), { requireConfidence: true })).toEqual([]);
  });

  it('only allows stops on the sell side', () => {
    expect(ticketFormErrors(draft({ type: 'STOP', side: 'BUY', price: '9.5' }), {}).join(' ')).toMatch(/can only sell/);
    expect(ticketFormErrors(draft({ type: 'STOP', side: 'SELL', price: '9.5' }), {})).toEqual([]);
  });

  it('builds the API command with only the fields of the chosen order type', () => {
    expect(toCommand(draft({ type: 'LIMIT', price: '9.8', confidence: '70' }))).toEqual({
      type: 'PLACE_ORDER',
      symbol: 'AAA',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 10,
      limitPrice: 9.8,
      rationale: 'LONG_TERM_VIEW',
      confidence: 70,
    });
    expect(toCommand(draft({ type: 'STOP', side: 'SELL', price: '9.5' }))).toMatchObject({ orderType: 'STOP', stopPrice: 9.5 });
    expect(toCommand(draft({}))).not.toHaveProperty('confidence');
  });
});
