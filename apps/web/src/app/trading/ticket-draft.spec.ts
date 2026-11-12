import { emptyTicket, termsKey, ticketErrors, toOrderTerms } from './ticket-draft';

describe('order ticket draft', () => {
  it('requires an instrument and a whole positive quantity', () => {
    expect(ticketErrors(emptyTicket())).toMatchObject({
      symbol: 'Choisissez un instrument.',
      quantity: "Saisissez un nombre entier d'unités, au moins 1.",
    });
    expect(ticketErrors({ ...emptyTicket('CTB'), quantity: '1.5' }).quantity).toBeDefined();
    expect(ticketErrors({ ...emptyTicket('CTB'), quantity: '0' }).quantity).toBeDefined();
    expect(ticketErrors({ ...emptyTicket('CTB'), quantity: '25' })).toEqual({});
    expect(ticketErrors({ ...emptyTicket('CTB'), quantity: '25' }, 10).quantity).toContain('taille de lot (10)');
  });

  it('requires a positive price with at most 3 decimals for limit and stop orders', () => {
    const limit = { ...emptyTicket('CTB'), type: 'LIMIT' as const, quantity: '10' };
    expect(ticketErrors(limit).limitPrice).toBe('Saisissez un cours limite.');
    expect(ticketErrors({ ...limit, limitPrice: '42.1234' }).limitPrice).toContain('3 décimales');
    expect(ticketErrors({ ...limit, limitPrice: '0' }).limitPrice).toBeDefined();
    expect(ticketErrors({ ...limit, limitPrice: '42.125' })).toEqual({});
  });

  it('allows stops only on sells', () => {
    const stop = { ...emptyTicket('CTB'), type: 'STOP' as const, quantity: '10', stopPrice: '40' };
    expect(ticketErrors(stop).type).toContain('ventes de protection');
    expect(ticketErrors({ ...stop, side: 'SELL' })).toEqual({});
  });

  it('sends only the price field that matches the order type', () => {
    const draft = { ...emptyTicket('CTB'), type: 'LIMIT' as const, quantity: '10', limitPrice: '41.5', stopPrice: '39' };
    expect(toOrderTerms(draft)).toEqual({ symbol: 'CTB', side: 'BUY', type: 'LIMIT', quantity: 10, limitPrice: 41.5 });
    expect(toOrderTerms({ ...draft, type: 'MARKET' })).toEqual({ symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 10 });
  });

  it('keys previews by exact terms', () => {
    const a = toOrderTerms({ ...emptyTicket('CTB'), quantity: '10' });
    expect(termsKey(a)).toBe(termsKey({ ...a }));
    expect(termsKey(a)).not.toBe(termsKey({ ...a, quantity: 11 }));
  });
});
