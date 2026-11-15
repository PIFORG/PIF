import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { FR } from '../core/i18n/fr';
const LINKS = [
  { href: '/settings/profile', label: FR.nav.profile },
  { href: '/settings/security', label: FR.nav.security },
  { href: '/settings/sessions', label: FR.nav.sessions },
];

@Component({
  selector: 'mtr-settings-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet],
  host: { style: 'display: contents' },
  template: `
    <div class="page-shell set-desk">
      <header class="set-top">
        <div>
          <p class="eyebrow">{{ copy.account }}</p>
          <h1 class="set-title">{{ copy.title }}</h1>
          <p class="set-lede">{{ copy.description }}</p>
        </div>
      </header>
      <nav class="set-nav" [attr.aria-label]="copy.navAria">
        @for (link of links; track link.href) {
          <a [routerLink]="link.href" class="set-navLink" [attr.aria-current]="pathname() === link.href ? 'page' : null">
            {{ link.label }}
          </a>
        }
      </nav>
      <div class="set-panel">
        <router-outlet />
      </div>
    </div>
  `,
  styles: [
    `
      .set-desk {
        display: grid;
        gap: var(--space-4);
      }
      .set-title {
        margin: 0.1rem 0 0;
        font-family: var(--font-display);
        font-size: clamp(1.35rem, 2.2vw, 1.7rem);
        font-weight: 650;
        letter-spacing: -0.02em;
      }
      .set-lede {
        margin: 0.35rem 0 0;
        max-width: 52ch;
        color: var(--mtr-text-2);
        font-size: 0.9375rem;
      }
      .set-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid var(--mtr-border);
      }
      .set-navLink {
        padding: 0.45rem 0.8rem;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        color: var(--mtr-text-2);
        text-decoration: none;
        font-size: 0.875rem;
        font-weight: 600;
      }
      .set-navLink[aria-current='page'] {
        border-color: color-mix(in srgb, var(--mtr-brand) 35%, var(--mtr-border));
        background: color-mix(in srgb, var(--mtr-brand) 8%, var(--mtr-surface));
        color: var(--mtr-brand-text);
      }
      .set-panel {
        min-width: 0;
      }
      :host ::ng-deep .set-sections {
        display: grid;
        gap: 1.25rem;
      }
      :host ::ng-deep .set-sectionHead {
        display: flex;
        gap: 0.75rem;
        align-items: center;
        margin-bottom: 1rem;
      }
      :host ::ng-deep .set-sectionHead h2 {
        margin: 0;
      }
    `,
  ],
})
export class SettingsLayoutComponent {
  private readonly router = inject(Router);
  protected readonly links = LINKS;
  protected readonly copy = {
    account: FR.common.account,
    title: FR.settings.title,
    description: FR.settings.description,
    navAria: FR.settings.navAria,
  };
  protected readonly pathname = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0]),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] },
  );
}
