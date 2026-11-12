import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { FR } from '../core/i18n/fr';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';

const LINKS = [
  { href: '/settings/profile', label: FR.nav.profile },
  { href: '/settings/security', label: FR.nav.security },
  { href: '/settings/sessions', label: FR.nav.sessions },
];

@Component({
  selector: 'mtr-settings-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, PageHeadingComponent],
  host: { style: 'display: contents' },
  template: `
    <div class="page-shell">
      <mtr-page-heading
        [eyebrow]="copy.account"
        [title]="copy.title"
        [description]="copy.description"
      />
      <nav class="subnav" [attr.aria-label]="copy.navAria">
        @for (link of links; track link.href) {
          <a [routerLink]="link.href" class="nav-link" [attr.aria-current]="pathname() === link.href ? 'page' : null">
            {{ link.label }}
          </a>
        }
      </nav>
      <router-outlet />
    </div>
  `,
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
