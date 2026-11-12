import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ProtectedRouteComponent } from '../auth/protected-route.component';
import type { UserRole } from '../core/api/types';
import { FR } from '../core/i18n/fr';
import { AppShellComponent } from '../layout/app-shell/app-shell.component';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';

const LINKS = [
  { href: '/admin', label: FR.nav.platform },
  { href: '/admin/users', label: FR.nav.users },
  { href: '/admin/audit', label: FR.nav.audit },
];

const ADMIN_ROLES: UserRole[] = ['ADMIN'];

/**
 * apps/web admin/layout.tsx: administrators with a verified email only. Signed out → sign-in with returnTo,
 * blocked status or another role → /unauthorized, unverified email → /resend-verification. UX only: the API
 * authorizes every /admin request itself.
 */
@Component({
  selector: 'mtr-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, ProtectedRouteComponent, AppShellComponent, PageHeadingComponent],
  host: { style: 'display: contents' },
  template: `
    <mtr-protected-route [roles]="roles" [requireEmailVerified]="true">
      <ng-template>
        <mtr-app-shell>
          <div class="page-shell adm-commandShell">
            <mtr-page-heading
              [eyebrow]="copy.eyebrow"
              [title]="copy.title"
              [description]="copy.description"
            />
            <nav class="subnav" [attr.aria-label]="copy.navAria">
              @for (link of links; track link.href) {
                <a [routerLink]="link.href" class="nav-link" [attr.aria-current]="isCurrent(link.href) ? 'page' : null">
                  {{ link.label }}
                </a>
              }
            </nav>
            <router-outlet />
          </div>
        </mtr-app-shell>
      </ng-template>
    </mtr-protected-route>
  `,
})
export class AdminLayoutComponent {
  private readonly router = inject(Router);
  protected readonly links = LINKS;
  protected readonly roles = ADMIN_ROLES;
  protected readonly copy = {
    eyebrow: FR.nav.groupAdmin,
    title: FR.admin.title,
    description: FR.admin.description,
    navAria: FR.admin.navAria,
  };
  protected readonly pathname = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0]),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] },
  );

  protected isCurrent(href: string): boolean {
    const pathname = this.pathname();
    return pathname === href || (href !== '/admin' && pathname.startsWith(href));
  }
}
