import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import '../../styles/lazy-admin';
import { ProtectedRouteComponent } from '../auth/protected-route.component';
import type { UserRole } from '../core/api/types';
import { FR } from '../core/i18n/fr';
import { ADMIN_NAV, isAdminItemActive } from '../core/navigation/admin-nav';
import { BrandLockupComponent } from '../shared/brand/brand.component';
import { IconComponent } from '../shared/icon/icon.component';
import { ThemeToggleComponent } from '../shared/theme-toggle/theme-toggle.component';
import { ProfileDropdownComponent } from '../layout/profile-dropdown/profile-dropdown.component';

const ADMIN_ROLES: UserRole[] = ['ADMIN'];

/**
 * Admin console: vertical sidebar only. No investor navbar / market tapes.
 * API still enforces ADMIN on every /admin request.
 */
@Component({
  selector: 'mtr-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterOutlet,
    ProtectedRouteComponent,
    BrandLockupComponent,
    IconComponent,
    ThemeToggleComponent,
    ProfileDropdownComponent,
  ],
  host: { style: 'display: contents' },
  styleUrl: './admin-layout.component.css',
  template: `
    <mtr-protected-route [roles]="roles" [requireEmailVerified]="true">
      <ng-template>
        <a href="#admin-main" class="skip-link">Aller au contenu</a>
        <div class="adm-shell" [attr.data-collapsed]="collapsed() ? 'true' : 'false'">
          <aside class="adm-side" aria-label="Administration">
            <div class="adm-sideTop">
              <a routerLink="/admin" class="adm-brand" aria-label="Administration">
                <mtr-brand-lockup [compact]="collapsed()" [size]="26" />
              </a>
              <button
                type="button"
                class="adm-collapse"
                (click)="toggleCollapsed()"
                [attr.aria-pressed]="collapsed()"
                [attr.aria-label]="collapsed() ? 'Développer la barre latérale' : 'Réduire la barre latérale'"
              >
                <svg mtrIcon [name]="collapsed() ? 'chevron-right' : 'chevron-left'" [size]="14"></svg>
              </button>
            </div>
            <p class="adm-sideLabel" [class.sr-only]="collapsed()">Administration</p>
            <nav class="adm-sideNav" aria-label="Navigation administrative">
              <ul>
                @for (item of links; track item.href) {
                  <li>
                    <a
                      [routerLink]="item.href"
                      class="adm-sideLink"
                      [attr.aria-current]="isCurrent(item.href) ? 'page' : null"
                      [attr.title]="collapsed() ? item.label : null"
                    >
                      <svg mtrIcon [name]="item.icon" class="adm-sideIcon"></svg>
                      @if (!collapsed()) {
                        <span>{{ item.label }}</span>
                      }
                    </a>
                  </li>
                }
              </ul>
            </nav>
            <div class="adm-sideFoot">
              <a routerLink="/dashboard" class="adm-switch" [attr.title]="collapsed() ? 'Espace investisseur' : null">
                <svg mtrIcon name="overview" [size]="14"></svg>
                @if (!collapsed()) {
                  <span>Espace investisseur</span>
                }
              </a>
            </div>
          </aside>

          <div class="adm-column">
            <header class="adm-top">
              <button
                #menuButton
                type="button"
                class="adm-mobileToggle"
                (click)="drawerOpen.set(true)"
                aria-label="Ouvrir la navigation admin"
                [attr.aria-expanded]="drawerOpen()"
              >
                <svg mtrIcon name="menu" [size]="18"></svg>
              </button>
              <div class="adm-topTitle">
                <p class="adm-eyebrow">{{ copy.eyebrow }}</p>
                <h1>{{ pageTitle() }}</h1>
              </div>
              <div class="adm-topActions">
                <mtr-theme-toggle />
                <mtr-profile-dropdown />
              </div>
            </header>
            <main id="admin-main" class="adm-main" tabindex="-1">
              <router-outlet />
            </main>
          </div>

          @if (drawerOpen()) {
            <div class="adm-drawerLayer">
              <button type="button" class="adm-backdrop" aria-label="Fermer" tabindex="-1" (click)="drawerOpen.set(false)"></button>
              <div #drawer class="adm-drawer" role="dialog" aria-modal="true" aria-label="Navigation administrative">
                <div class="adm-drawerHead">
                  <strong>Administration</strong>
                  <button type="button" class="adm-mobileToggle" (click)="closeDrawer(true)" aria-label="Fermer">
                    <svg mtrIcon name="close" [size]="18"></svg>
                  </button>
                </div>
                <nav>
                  <ul class="adm-drawerList">
                    @for (item of links; track item.href) {
                      <li>
                        <a [routerLink]="item.href" [attr.aria-current]="isCurrent(item.href) ? 'page' : null" (click)="drawerOpen.set(false)">
                          {{ item.label }}
                        </a>
                      </li>
                    }
                    <li><a routerLink="/dashboard" (click)="drawerOpen.set(false)">Espace investisseur</a></li>
                  </ul>
                </nav>
              </div>
            </div>
          }
        </div>
      </ng-template>
    </mtr-protected-route>
  `,
})
export class AdminLayoutComponent {
  private readonly router = inject(Router);
  protected readonly links = ADMIN_NAV;
  protected readonly roles = ADMIN_ROLES;
  protected readonly copy = {
    eyebrow: FR.nav.groupAdmin,
  };
  protected readonly collapsed = signal(false);
  protected readonly drawerOpen = signal(false);
  protected readonly pathname = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0]),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] },
  );

  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly drawer = viewChild<ElementRef<HTMLElement>>('drawer');

  constructor() {
    try {
      this.collapsed.set(window.localStorage.getItem('mtrs-admin-sidebar-collapsed') === 'true');
    } catch {
      // ignore
    }
    const destroyRef = inject(DestroyRef);
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.drawerOpen()) {
        this.closeDrawer(true);
        return;
      }
      if (e.key !== 'Tab' || !this.drawerOpen()) return;
      const panel = this.drawer()?.nativeElement;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    destroyRef.onDestroy(() => document.removeEventListener('keydown', onKey));
    afterRenderEffect(() => {
      if (this.drawerOpen()) this.drawer()?.nativeElement.querySelector<HTMLElement>('a, button')?.focus();
    });
  }

  protected pageTitle(): string {
    const path = this.pathname();
    const hit = this.links.find((l) => isAdminItemActive(l, path));
    return hit?.label ?? FR.admin.title;
  }

  protected isCurrent(href: string): boolean {
    const item = this.links.find((l) => l.href === href);
    return item ? isAdminItemActive(item, this.pathname()) : false;
  }

  protected toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      window.localStorage.setItem('mtrs-admin-sidebar-collapsed', String(next));
    } catch {
      // ignore
    }
  }

  protected closeDrawer(restoreFocus: boolean): void {
    this.drawerOpen.set(false);
    if (restoreFocus) this.menuButton()?.nativeElement.focus();
  }
}