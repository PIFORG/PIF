import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrandLockupComponent } from '../../shared/brand/brand.component';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';

/**
 * Auth shell — editorial FinTech access screen.
 * No decorative candle charts, no marketing half-pane, no status badges.
 * Pages project footer links with `<ng-container ngProjectAs="[authFooter]">`.
 * Encapsulation None so projected form controls inherit shell layout rules.
 */
@Component({
  selector: 'mtr-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink, BrandLockupComponent, ThemeToggleComponent],
  host: { style: 'display: contents' },
  styleUrl: './auth-layout.component.css',
  template: `
    <div class="mtr-auth-shell">
      <header class="top">
        <a routerLink="/" class="brand" aria-label="Market Trading Room — accueil">
          <mtr-brand-lockup [size]="28" />
        </a>
        <mtr-theme-toggle />
      </header>

      <main class="stage" id="main-content">
        <div class="card">
          <h1 class="title">{{ title() }}</h1>
          @if (lead()) {
            <p class="lead">{{ lead() }}</p>
          }
          <div class="body">
            <ng-content />
          </div>
          @if (showFooter()) {
            <div class="footer"><ng-content select="[authFooter]" /></div>
          }
        </div>
      </main>

      <footer class="legal">
        <p>Marchés et capitaux simulés · usage pédagogique · aucun conseil en investissement</p>
      </footer>
    </div>
  `,
})
export class AuthLayoutComponent {
  readonly title = input.required<string>();
  readonly lead = input<string | undefined>(undefined);
  readonly showFooter = input(false);
}
