import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, type AuthStatus } from '../core/auth/auth.service';
import { SAMPLE_CURRENCY, sampleSummary } from '../core/demo/sample-workspace';
import { formatMoney } from '../core/format/finance';
import { LandingPage } from './landing.page';

@Component({ selector: 'mtr-dashboard-stub', template: '<h1>Dashboard</h1>' })
class DashboardStub {}

describe('Landing page', () => {
  let status: ReturnType<typeof signal<AuthStatus>>;

  beforeEach(() => {
    status = signal<AuthStatus>('unauthenticated');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', pathMatch: 'full', component: LandingPage },
          { path: 'dashboard', component: DashboardStub },
        ]),
        { provide: AuthService, useValue: { status } },
      ],
    });
  });

  it('presents the simulator to a signed-out visitor', async () => {
    const harness = await RouterTestingHarness.create('/');
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent).toBe('Les marchés financiers, sans le risque du monde réel.');
    expect(Array.from(root.querySelectorAll('.mk-pillar h3')).map((h) => h.textContent)).toEqual([
      'Salle de trading simulée',
      'Portefeuilles et analyse des risques',
      'Stratégies et backtesting',
      'Analyses IA que vous pouvez questionner',
      'Tests de résistance bancaire',
      'Laboratoire actuariel',
    ]);
    expect(Array.from(root.querySelectorAll('.mk-stepIndex')).map((s) => s.textContent)).toEqual(['01', '02', '03']);
    expect(root.querySelector('.mk-checks')?.textContent).toContain('FinStories : histoires de décision en une minute');
    expect(Array.from(root.querySelectorAll('.mk-topActions a')).map((a) => a.getAttribute('href'))).toEqual(['/login', '/register']);
    const preview = root.querySelector('figure.mk-window')!;
    expect(preview.querySelector('.mk-headValue')?.textContent).toBe(formatMoney(sampleSummary().equity, SAMPLE_CURRENCY));
    expect(preview.querySelector('.ws-demo')?.textContent).toContain("Données d'exemple");
    expect(preview.querySelectorAll('.mk-watch li').length).toBe(4);
  });

  it('jumps to a section in place instead of letting the router scroll back to the top', async () => {
    const harness = await RouterTestingHarness.create('/');
    await harness.fixture.whenStable();
    const original = Element.prototype.scrollIntoView;
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    try {
      (harness.routeNativeElement!.querySelector('a[href="#capabilities"]') as HTMLAnchorElement).click();
      expect(scrolled).toEqual(['capabilities']);
      expect(location.hash).toBe('#capabilities');
      expect(TestBed.inject(Router).url).toBe('/');
    } finally {
      Element.prototype.scrollIntoView = original;
      history.replaceState(history.state, '', location.pathname);
    }
  });

  it('waits for the session before choosing what to show', async () => {
    status.set('loading');
    const harness = await RouterTestingHarness.create('/');
    expect((harness.routeNativeElement as HTMLElement).textContent?.trim()).toBe('Chargement…');
  });

  it('sends a signed-in visitor to the dashboard', async () => {
    status.set('authenticated');
    const harness = await RouterTestingHarness.create('/');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/dashboard');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Dashboard');
  });
});
