import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { HealthApi, type ServiceHealth } from '../../core/api/health';
import { AuthService } from '../../core/auth/auth.service';
import {
  findNavItem,
  isItemActive,
  MOBILE_PRIMARY,
  navForRole,
  STATUS_LABEL,
  type NavItem,
} from '../../core/navigation/workspace-nav';
import { BrandLockupComponent } from '../../shared/brand/brand.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';
import { ProfileDropdownComponent } from '../profile-dropdown/profile-dropdown.component';

const COLLAPSE_KEY = 'mtrs-sidebar-collapsed';

const HEALTH_TEXT: Record<ServiceHealth, string> = {
  online: 'Services opérationnels',
  degraded: 'Base de données indisponible',
  offline: 'API inaccessible',
};

function pathOf(url: string): string {
  return url.split(/[?#]/)[0] || '/';
}

@Component({
  selector: 'mtr-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, BrandLockupComponent, IconComponent, ThemeToggleComponent, ProfileDropdownComponent],
  host: { style: 'display: contents' },
  styleUrl: './app-shell.component.css',
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly healthApi = inject(HealthApi);

  protected readonly pathname = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => pathOf(e.urlAfterRedirects)),
    ),
    { initialValue: pathOf(this.router.url) },
  );
  protected readonly user = this.auth.user;
  protected readonly groups = computed(() => navForRole(this.user()?.role));
  protected readonly location = computed(() => findNavItem(this.pathname()));
  protected readonly mobileItems = computed(() =>
    this.groups()
      .flatMap((group) => group.items)
      .filter((item) => MOBILE_PRIMARY.includes(item.href)),
  );
  protected readonly statusLabel = STATUS_LABEL;

  protected readonly collapsed = signal(false);
  protected readonly drawerOpen = signal(false);
  protected readonly health = signal<ServiceHealth | null>(null);
  protected readonly healthText = HEALTH_TEXT;
  protected readonly now = signal(new Date());
  protected readonly clockText = computed(() => this.formatClock(this.now(), this.user()?.preferences?.timezone));
  protected readonly clockTitle = computed(() => {
    const zone = this.user()?.preferences?.timezone;
    return zone ? `Votre fuseau horaire : ${zone}` : 'Heure de l\'appareil';
  });

  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly drawer = viewChild<ElementRef<HTMLElement>>('drawer');

  constructor() {
    try {
      this.collapsed.set(window.localStorage.getItem(COLLAPSE_KEY) === 'true');
    } catch {
      // Preference unavailable; keep the expanded sidebar.
    }

    const destroyRef = inject(DestroyRef);
    let cancelled = false;
    const check = () => this.healthApi.fetchServiceHealth().then((h) => !cancelled && this.health.set(h));
    void check();
    const healthTimer = window.setInterval(check, 60_000);
    const clockTimer = window.setInterval(() => this.now.set(new Date()), 30_000);
    destroyRef.onDestroy(() => {
      cancelled = true;
      window.clearInterval(healthTimer);
      window.clearInterval(clockTimer);
    });

    const onKey = (e: KeyboardEvent) => {
      if (!this.drawerOpen()) return;
      const drawer = this.drawer()?.nativeElement;
      if (e.key === 'Escape') {
        this.closeDrawer(true);
        return;
      }
      if (e.key !== 'Tab' || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('a, button'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    destroyRef.onDestroy(() => document.removeEventListener('keydown', onKey));

    afterRenderEffect(() => {
      if (this.drawerOpen()) this.drawer()?.nativeElement.querySelector<HTMLElement>('a, button')?.focus();
    });
  }

  private formatClock(now: Date, timeZone: string | undefined): string {
    try {
      return new Intl.DateTimeFormat('fr-TN', { hour: '2-digit', minute: '2-digit', timeZone, timeZoneName: 'short' }).format(now);
    } catch {
      return new Intl.DateTimeFormat('fr-TN', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(now);
    }
  }

  protected isActive(item: NavItem): boolean {
    return isItemActive(item, this.pathname());
  }

  protected linkTitle(item: NavItem, collapsed: boolean): string | null {
    if (item.status !== 'LIVE_INTEGRATED') {
      return `${item.label} — ${STATUS_LABEL[item.status].toLowerCase()}, moteur en attente`;
    }
    return collapsed ? item.label : null;
  }

  protected toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, String(next));
    } catch {
      // Not persisted.
    }
  }

  protected closeDrawer(restoreFocus: boolean): void {
    this.drawerOpen.set(false);
    if (restoreFocus) this.menuButton()?.nativeElement.focus();
  }
}
