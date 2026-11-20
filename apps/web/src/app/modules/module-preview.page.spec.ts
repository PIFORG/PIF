import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { MODULES, PREVIEW_MODULE_ROUTES, type ModuleDefinition } from './module-catalog';
import { ModulePreviewPage } from './module-preview.page';

describe('ModulePreviewPage', () => {
  async function render(definition: ModuleDefinition) {
    TestBed.configureTestingModule({ imports: [ModulePreviewPage], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ModulePreviewPage);
    fixture.componentRef.setInput('definition', definition);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('states plainly that the module is not connected and lists pending integrations', async () => {
    const module = MODULES['stress-testing'];
    const root = await render(module);
    expect(root.querySelector('h1')?.textContent).toBe(module.title);
    expect(root.querySelector('.ws-status')?.textContent).toContain('Aperçu · moteur en attente');
    expect(root.querySelector('.mp-notice')?.textContent).toContain('Conception validée, moteur non connecté.');
    expect(root.textContent).toContain(module.contracts[0].purpose);
    expect(Array.from(root.querySelectorAll('.badge')).filter((b) => b.textContent === 'Prévu').length).toBe(module.contracts.length);
    expect(Array.from(root.querySelectorAll('.mp-block')).map((b) => b.getAttribute('data-span'))).toEqual(
      module.blueprint.map((b) => String(b.span)),
    );
  });

  it('renders the trading ticket fully disabled with an explanation', async () => {
    const root = await render(MODULES['trading']);
    const submit = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Review order') as HTMLButtonElement;
    expect(submit.closest('fieldset')?.disabled).toBe(true);
    expect(root.textContent).toContain('Les prix sont simulés et étiquetés comme tels');
    expect(root.textContent).toContain("Aucun ordre n'est jamais envoyé sur un marché réel");
  });

  it('reads the module from the route data', async () => {
    TestBed.configureTestingModule({
      imports: [ModulePreviewPage],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { data: { module: 'stress-testing' } } } }],
    });
    const fixture = TestBed.createComponent(ModulePreviewPage);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent).toBe('Simuler une crise bancaire');
    expect(root.querySelector('.eyebrow')?.textContent).toBe('Analyses');
    expect(root.querySelector('a.btn-secondary')?.getAttribute('href')).toBe('/dashboard');
  });
  it('has a catalog entry for every preview route', () => {
    for (const slug of PREVIEW_MODULE_ROUTES) expect(MODULES[slug]?.slug).toBe(slug);
  });
});
