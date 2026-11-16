import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MarketPulseComponent } from './market-pulse.component';
import { MarketApi } from '../../core/api/trading-api';

describe('MarketPulseComponent', () => {
  it('affiche les cotations simulees fournies par l API', async () => {
    const api = {
      instruments: async () => ({
        provenance: { providerId: 'sim', kind: 'FICTIONAL' as const, currency: 'TND', description: 'simule' },
        asOf: '2026-11-15T12:00:00Z',
        instruments: [
          {
            id: '1',
            symbol: 'TEK',
            name: 'TunisTech',
            assetClass: 'EQUITY' as const,
            sector: 'Tech',
            currency: 'TND',
            status: 'ACTIVE' as const,
            priceDecimals: 3,
            quantityDecimals: 0,
            lotSize: 1,
            fees: { feeBps: 10, minFee: 1 },
            fictional: true,
            provenance: { providerId: 'sim', kind: 'FICTIONAL' as const, currency: 'TND', description: 'simule' },
            quote: {
              mid: 50,
              bid: 49.9,
              ask: 50.1,
              spreadBps: 40,
              depth: 100,
              asOf: '2026-11-15T12:00:00Z',
              validUntil: '2026-11-15T12:05:00Z',
            },
            previousClose: 49,
            changePct: 2.04,
          },
        ],
      }),
    };

    await TestBed.configureTestingModule({
      imports: [MarketPulseComponent],
      providers: [provideRouter([]), { provide: MarketApi, useValue: api }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MarketPulseComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Marché simulé');
    expect(text).toContain('TEK');
  });

  it('signale une erreur API sans inventer de cotations', async () => {
    const api = {
      instruments: async () => {
        throw new Error('down');
      },
    };
    await TestBed.configureTestingModule({
      imports: [MarketPulseComponent],
      providers: [provideRouter([]), { provide: MarketApi, useValue: api }],
    }).compileComponents();
    const fixture = TestBed.createComponent(MarketPulseComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeTruthy();
  });
});
