import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { HealthApi, type ServiceHealth } from '../../core/api/health';
import {
  INVESTOR_NAV,
  isInvestorItemActive,
  isInvestorSectionActive,
  type InvestorNavSection,
} from '../../core/navigation/investor-nav';
import type { NavItem } from '../../core/navigation/workspace-nav';
import { BrandLockupComponent } from '../../shared/brand/brand.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { MarketPulseComponent } from '../../shared/market-pulse/market-pulse.component';
import { FinancialNewsWireComponent } from '../../shared/news-wire/news-wire.component';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';
import { ProfileDropdownComponent } from '../profile-dropdown/profile-dropdown.component';

function pathOf(url: string): string {
  return url.split(/[?#]/)[0] || '/';
}

const HEALTH_TEXT: Record<ServiceHealth, string> = {
  online: 'Plateforme disponible',
  degraded: 'Base de données indisponible',
  offline: 'Plateforme inaccessible',
};

const HEALTH_SHORT: Record<ServiceHealth, string> = {
  online: 'En ligne',
  degraded: 'Dégradé',
  offline: 'Hors ligne',
};

/** Investor workspace shell: horizontal navbar, no permanent sidebar. */
@Component({
  selector: 'mtr-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    BrandLockupComponent,
    IconComponent,
    ThemeToggleComponent,
    ProfileDropdownComponent,
    MarketPulseComponent,
    FinancialNewsWireComponent,
  ],
  host: { style: 'display: contents' },
  styleUrl: './app-shell.component.css',
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  private readonly router = inject(Router);
  private readonly healthApi = inject(HealthApi);

  protected readonly sections = INVESTOR_NAV;
  protected readonly pathname = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => pathOf(e.urlAfterRedirects)),
    ),
    { initialValue: pathOf(this.router.url) },
  );

  protected readonly openSection = signal<string | null>(null);
  protected readonly drawerOpen = signal(false);
  protected readonly health = signal<ServiceHealth | null>(null);
  protected readonly healthText = HEALTH_TEXT;
  protected readonly healthShort = HEALTH_SHORT;

  private closeTimer: number | null = null;
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly drawer = viewChild<ElementRef<HTMLElement>>('drawer');
  private readonly navRoot = viewChild<ElementRef<HTMLElement>>('navRoot');

  constructor() {
    const destroyRef = inject(DestroyRef);
    let cancelled = false;
    const check = () => this.healthApi.fetchServiceHealth().then((h) => !cancelled && this.health.set(h));
    void check();
    const healthTimer = window.setInterval(check, 60_000);
    destroyRef.onDestroy(() => {
      cancelled = true;
      window.clearInterval(healthTimer);
      if (this.closeTimer) window.clearTimeout(this.closeTimer);
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.drawerOpen()) this.closeDrawer(true);
        else if (this.openSection()) this.openSection.set(null);
      }
    };
    document.addEventListener('keydown', onKey);
    destroyRef.onDestroy(() => document.removeEventListener('keydown', onKey));

    // Click-primary menus: close when clicking outside the open section.
    const onDocPointer = (e: Event) => {
      if (!this.openSection()) return;
      const nav = this.navRoot()?.nativeElement;
      const target = e.target as Node | null;
      if (nav && target && !nav.contains(target)) this.openSection.set(null);
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    destroyRef.onDestroy(() => document.removeEventListener('pointerdown', onDocPointer, true));

    // Close dropdown after a successful navigation.
    const sub = this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(() => {
      this.openSection.set(null);
    });
    destroyRef.onDestroy(() => sub.unsubscribe());

    afterRenderEffect(() => {
      if (this.drawerOpen()) this.drawer()?.nativeElement.querySelector<HTMLElement>('a, button')?.focus();
    });
  }

  protected isSectionActive(section: InvestorNavSection): boolean {
    return isInvestorSectionActive(section, this.pathname());
  }

  protected isItemActive(item: NavItem): boolean {
    return isInvestorItemActive(item, this.pathname());
  }

  protected toggleSection(id: string, event?: Event): void {
    event?.stopPropagation();
    this.cancelClose();
    this.openSection.update((cur) => (cur === id ? null : id));
  }

  protected onSectionKey(event: KeyboardEvent, id: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleSection(id);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.openSection.set(id);
      queueMicrotask(() => {
        document.getElementById(`inv-menu-${id}`)?.querySelector<HTMLElement>('a[role="menuitem"]')?.focus();
      });
    } else if (event.key === 'Escape') {
      this.openSection.set(null);
    }
  }

  protected closeSectionSoon(): void {
    if (this.closeTimer) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => this.openSection.set(null), 220);
  }

  protected cancelClose(): void {
    if (this.closeTimer) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  protected closeDrawer(restoreFocus: boolean): void {
    this.drawerOpen.set(false);
    if (restoreFocus) this.menuButton()?.nativeElement.focus();
  }
}
