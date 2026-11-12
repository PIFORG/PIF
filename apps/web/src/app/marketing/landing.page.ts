import { afterNextRender, ChangeDetectionStrategy, Component, DOCUMENT, effect, inject, Injector } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { BrandLockupComponent } from '../shared/brand/brand.component';
import { IconComponent, type IconName } from '../shared/icon/icon.component';
import { ThemeToggleComponent } from '../shared/theme-toggle/theme-toggle.component';
import { StatusBadgeComponent } from '../shared/workspace/workspace.components';
import { ProductPreviewComponent } from './product-preview.component';

const PILLARS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'trading',
    title: 'Salle de trading simulée',
    body: 'Passez des ordres au marché ou à cours limité sur un capital virtuel et observez l\'impact de l\'exécution, des frais et du glissement.',
  },
  {
    icon: 'risk',
    title: 'Portefeuilles et analyse des risques',
    body: 'Suivez l\'allocation, le drawdown, la volatilité et la valeur à risque, chaque indicateur expliqué clairement.',
  },
  {
    icon: 'strategy',
    title: 'Stratégies et tests historiques',
    body: 'Décrivez une stratégie par règles, rejouez-la sur des scénarios historiques et comparez-la à un indice de référence.',
  },
  {
    icon: 'xai',
    title: 'Analyses IA que vous pouvez questionner',
    body: 'Les sorties des modèles sont accompagnées de confiance, de facteurs explicatifs et de limites — conçues pour être explicables, jamais comme un conseil.',
  },
  {
    icon: 'bank',
    title: 'Tests de résistance bancaire',
    body: 'Appliquez des chocs de taux, de crédit et de liquidité à un bilan type et lisez l\'impact sur les fonds propres étape par étape.',
  },
  {
    icon: 'actuarial',
    title: 'Laboratoire actuariel',
    body: 'Explorez tables de mortalité, réserves et tarification des primes avec des hypothèses transparentes et reproductibles.',
  },
];

const STEPS = [
  {
    title: 'Créez un compte sécurisé',
    body: 'Courriel vérifié, MFA optionnelle via application d\'authentification et contrôle complet de vos appareils connectés.',
  },
  {
    title: 'Entraînez-vous avec du capital virtuel',
    body: 'Constituez des portefeuilles simulés et testez vos idées dans une salle de marché où les erreurs ne coûtent rien.',
  },
  {
    title: 'Analysez, apprenez et progressez',
    body: 'Évaluez les risques, comparez des stratégies et suivez des parcours guidés qui relient la théorie à chaque décision.',
  },
];

const LIVE_NOW = [
  'Comptes avec vérification du courriel',
  'MFA via application d\'authentification et codes de récupération',
  'Gestion des appareils et des sessions',
  'Administration par rôles et journal d\'audit',
  'Parcours d\'apprentissage dans un marché simulé, avec évaluation et relecture',
  'Histoires financières : histoires de décision en une minute',
];

const IN_DEVELOPMENT = [
  'Données de marché en direct et salle de trading principale',
  'Moteurs de portefeuille, de risque et de tests historiques',
  'Analyses IA et explicabilité',
  'Tests de résistance et laboratoire actuariel',
];

/** `/`: apps/web/src/app/page.tsx. Signed-in visitors go straight to the dashboard. */
@Component({
  selector: 'mtr-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BrandLockupComponent, IconComponent, ThemeToggleComponent, StatusBadgeComponent, ProductPreviewComponent],
  host: { style: 'display: contents', '(click)': 'onSectionLink($event)' },
  templateUrl: './landing.page.html',
})
export class LandingPage {
  private readonly document = inject(DOCUMENT);
  protected readonly status = inject(AuthService).status;
  protected readonly pillars = PILLARS;
  protected readonly steps = STEPS.map((step, i) => ({ ...step, index: String(i + 1).padStart(2, '0') }));
  protected readonly liveNow = LIVE_NOW;
  protected readonly inDevelopment = IN_DEVELOPMENT;

  constructor() {
    const router = inject(Router);
    const injector = inject(Injector);
    let initialHashHandled = false;
    effect(() => {
      const status = this.status();
      if (status === 'authenticated') void router.navigateByUrl('/dashboard', { replaceUrl: true });
      if (status !== 'unauthenticated' || initialHashHandled) return;
      initialHashHandled = true;
      // The router resets scroll to the top after each navigation (scrollPositionRestoration: 'top').
      afterNextRender(() => setTimeout(() => this.sectionFor(this.document.location.hash)?.scrollIntoView()), {
        injector,
      });
    });
  }

  /**
   * Same-page `#section` links scroll natively in Next.js. Here a hash change is a router navigation
   * that scrolls back to the top, so the jump is done without notifying the router.
   */
  protected onSectionLink(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const hash = (event.target as Element | null)?.closest('a[href^="#"]')?.getAttribute('href');
    const section = hash ? this.sectionFor(hash) : null;
    if (!hash || !section) return;
    event.preventDefault();
    const history = this.document.defaultView?.history;
    if (this.document.location.hash !== hash) history?.pushState(history.state, '', hash);
    section.scrollIntoView();
  }

  private sectionFor(hash: string): HTMLElement | null {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    return id ? this.document.getElementById(id) : null;
  }
}
