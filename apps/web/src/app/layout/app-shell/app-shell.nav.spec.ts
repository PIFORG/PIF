import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HealthApi } from '../../core/api/health';
import { MarketApi } from '../../core/api/trading-api';
import { NewsApi } from '../../core/api/news-api';
import { AuthService } from '../../core/auth/auth.service';
import { AppShellComponent } from './app-shell.component';

@Component({
  selector: 'mtr-nav-host',
  imports: [AppShellComponent],
  template: `<mtr-app-shell><p id="page">ok</p></mtr-app-shell>`,
})
class NavHostComponent {}

@Component({ selector: 'mtr-stub-page', template: `<h1>stub</h1>` })
class StubPage {}

describe('Investor navbar menus (AppShell)', () => {
  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    await TestBed.configureTestingModule({
      imports: [NavHostComponent],
      providers: [
        provideRouter([
          { path: 'dashboard', component: StubPage },
          { path: 'markets', component: StubPage },
          { path: 'trading', component: StubPage },
          { path: 'portfolios', component: StubPage },
          { path: 'risk', component: StubPage },
          { path: 'stories', component: StubPage },
          { path: 'learn', component: StubPage },
          { path: '**', component: StubPage },
        ]),
        {
          provide: AuthService,
          useValue: {
            status: () => 'authenticated',
            user: () => ({
              id: 'u1',
              email: 'ada@example.com',
              firstName: 'Ada',
              lastName: 'Lovelace',
              role: 'INVESTOR',
            }),
            logout: vi.fn(),
          },
        },
        { provide: HealthApi, useValue: { fetchServiceHealth: vi.fn().mockResolvedValue('online') } },
        {
          provide: MarketApi,
          useValue: {
            instruments: vi.fn().mockResolvedValue({
              provenance: { providerId: 'sim', kind: 'FICTIONAL', currency: 'TND', description: 'sim' },
              asOf: '2026-11-15T12:00:00Z',
              instruments: [],
            }),
          },
        },
        {
          provide: NewsApi,
          useValue: {
            feed: vi.fn().mockResolvedValue({
              items: [],
              source: { id: 'pedagogy', kind: 'SYNTHETIC_PEDAGOGICAL', description: 'ped' },
              limitations: [],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => vi.unstubAllGlobals());

  function render() {
    const fixture = TestBed.createComponent(NavHostComponent);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('renders the six investor categories without a permanent sidebar', () => {
    const { root } = render();
    const nav = root.querySelector('nav[aria-label="Navigation principale"]') as HTMLElement;
    expect(nav.textContent).toContain("Vue d'ensemble");
    expect(nav.textContent).toContain('Marchés');
    expect(nav.textContent).toContain('Négociation');
    expect(nav.textContent).toContain('Portefeuilles');
    expect(nav.textContent).toContain('Analyses');
    expect(nav.textContent).toContain('Apprentissage');
    expect(root.querySelector('aside.adm-side')).toBeFalsy();
  });

  it('opens dropdown menus on click and keeps them in the DOM', () => {
    const { fixture, root } = render();
    for (const label of ['Marchés', 'Négociation', 'Analyses', 'Apprentissage']) {
      const btn = Array.from(root.querySelectorAll('button.inv-link')).find((b) =>
        b.textContent?.includes(label),
      ) as HTMLButtonElement;
      expect(btn).toBeTruthy();
      btn.click();
      fixture.detectChanges();
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      const menu = root.querySelector('.inv-menu[role="menu"]');
      expect(menu).toBeTruthy();
    }
  });

  it('exposes Analyses > Analyser les risques with a real href', () => {
    const { fixture, root } = render();
    const analyzeBtn = Array.from(root.querySelectorAll('button.inv-link')).find((b) =>
      b.textContent?.includes('Analyses'),
    ) as HTMLButtonElement;
    analyzeBtn.click();
    fixture.detectChanges();
    const risk = Array.from(root.querySelectorAll('#inv-menu-analyze a')).find((a) =>
      a.textContent?.includes('Analyser les risques'),
    ) as HTMLAnchorElement;
    expect(risk.getAttribute('href')).toBe('/risk');
  });

  it('exposes Portefeuilles as a direct router link', () => {
    const { root } = render();
    const link = Array.from(root.querySelectorAll('a.inv-link')).find(
      (a) => a.textContent?.trim() === 'Portefeuilles',
    ) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/portfolios');
  });

  it('closes an open menu on Escape', () => {
    const { fixture, root } = render();
    const btn = Array.from(root.querySelectorAll('button.inv-link')).find((b) =>
      b.textContent?.includes('Marchés'),
    ) as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    expect(root.querySelector('#inv-menu-markets')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('#inv-menu-markets')).toBeFalsy();
  });
});