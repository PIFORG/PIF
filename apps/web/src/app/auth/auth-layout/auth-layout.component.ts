import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrandLockupComponent } from '../../shared/brand/brand.component';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';

const ASSURANCES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'lock',
    title: 'Connexion sécurisée',
    body: 'Authentification à deux facteurs (application d’authentification) avec codes de récupération à usage unique, en option.',
  },
  {
    icon: 'sessions',
    title: 'Vous contrôlez chaque appareil',
    body: 'Consultez et déconnectez les sessions actives depuis les paramètres de votre compte.',
  },
  {
    icon: 'flask',
    title: 'Simulation uniquement',
    body: 'Capitaux virtuels et marchés simulés. Aucun argent réel n’est jamais engagé.',
  },
];

/** Decorative market-grid illustration; carries no data. */
const CANDLES = [
  [30, 52, 40, 60],
  [40, 58, 36, 62],
  [36, 46, 30, 52],
  [46, 64, 42, 70],
  [60, 54, 50, 66],
  [54, 72, 50, 78],
  [70, 82, 64, 88],
  [80, 74, 70, 86],
  [74, 92, 70, 98],
].map(([open, close, low, high], i) => {
  const x = 18 + i * 34;
  const top = 120 - Math.max(open, close);
  const bottom = 120 - Math.min(open, close);
  return { x, up: close >= open, y1: 120 - high, y2: 120 - low, top, height: Math.max(bottom - top, 2) };
});

/** Pages project their footer with `<ng-container ngProjectAs="[authFooter]">` and set `[showFooter]="true"`. */
@Component({
  selector: 'mtr-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BrandLockupComponent, IconComponent, ThemeToggleComponent],
  host: { style: 'display: contents' },
  styleUrl: './auth-layout.component.css',
  template: `
    <div class="shell">
      <aside class="brandPane" aria-label="À propos de Market Trading Room">
        <a routerLink="/" class="brandLink" aria-label="Market Trading Room — accueil">
          <mtr-brand-lockup [size]="34" />
        </a>

        <div class="statement">
          <p class="headline">Les marchés financiers, <span>sans le risque du monde réel.</span></p>
          <p class="tagline">
            Entraînez-vous au trading, à la construction de portefeuille et à l’analyse des risques dans une salle de
            marché simulée conçue pour l’apprentissage.
          </p>
          <svg class="illustration" viewBox="0 0 320 120" aria-hidden="true" focusable="false">
            @for (c of candles; track c.x) {
              <g [attr.data-up]="c.up ? 'true' : 'false'">
                <line [attr.x1]="c.x" [attr.x2]="c.x" [attr.y1]="c.y1" [attr.y2]="c.y2" />
                <rect [attr.x]="c.x - 7" [attr.y]="c.top" width="14" [attr.height]="c.height" rx="2" />
              </g>
            }
            <path d="M18 74 L52 66 L86 78 L120 60 L154 58 L188 46 L222 34 L256 40 L290 26" class="trend" />
          </svg>
        </div>

        <ul class="assurances">
          @for (item of assurances; track item.title) {
            <li>
              <span class="assuranceIcon"><svg mtrIcon [name]="item.icon" [size]="16"></svg></span>
              <span>
                <strong>{{ item.title }}</strong>
                <span>{{ item.body }}</span>
              </span>
            </li>
          }
        </ul>
      </aside>

      <main class="formPane" id="main-content">
        <div class="formTop">
          <a routerLink="/" class="mobileBrand" aria-label="Market Trading Room — accueil">
            <mtr-brand-lockup [size]="28" />
          </a>
          <mtr-theme-toggle />
        </div>
        <div class="formInner">
          <h1 class="formTitle">{{ title() }}</h1>
          @if (lead()) {
            <p class="formLead">{{ lead() }}</p>
          }
          <ng-content />
          @if (showFooter()) {
            <div class="footerLinks"><ng-content select="[authFooter]" /></div>
          }
        </div>
        <p class="legal">Simulation pédagogique. Ne constitue pas un conseil en investissement.</p>
      </main>
    </div>
  `,
})
export class AuthLayoutComponent {
  readonly title = input.required<string>();
  readonly lead = input<string | undefined>(undefined);
  readonly showFooter = input(false);
  protected readonly assurances = ASSURANCES;
  protected readonly candles = CANDLES;
}
