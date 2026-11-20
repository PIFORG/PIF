import { TestBed } from '@angular/core/testing';
import { FinancialNewsWireComponent } from './news-wire.component';
import { NewsApi } from '../../core/api/news-api';

describe('FinancialNewsWireComponent', () => {
  it('marque les titres pedagogiques et affiche le fil', async () => {
    const api = {
      feed: async () => ({
        items: [
          {
            id: 'n1',
            title: 'Hausse des benefices bancaires simules',
            summary: 'Scenario pedagogique.',
            symbol: 'CTB',
            sector: 'Banques',
            publishedAt: '2026-11-15T10:00:00Z',
            provenance: 'SYNTHETIC_PEDAGOGICAL',
          },
        ],
        source: { id: 'pedagogy', kind: 'SYNTHETIC_PEDAGOGICAL', description: 'Scenarios pedagogiques' },
        limitations: [] as string[],
      }),
    };

    await TestBed.configureTestingModule({
      imports: [FinancialNewsWireComponent],
      providers: [{ provide: NewsApi, useValue: api }],
    }).compileComponents();

    const fixture = TestBed.createComponent(FinancialNewsWireComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Actualités');
    expect(text).not.toContain('RSS réels');
    expect(text).toContain('Hausse des benefices bancaires simules');
  });
});
