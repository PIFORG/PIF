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
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { FR } from '../../core/i18n/fr';

let nextMenuId = 0;

@Component({
  selector: 'mtr-profile-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { style: 'display: contents' },
  styleUrl: './profile-dropdown.component.css',
  template: `
    @if (auth.user(); as user) {
      <div class="root" #root>
        <button
          #trigger
          type="button"
          class="trigger"
          aria-haspopup="menu"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="open() ? menuId : null"
          [attr.aria-label]="'Menu du compte pour ' + user.firstName + ' ' + user.lastName"
          (click)="open.set(!open())"
          (keydown)="onTriggerKeyDown($event)"
        >
          <span class="avatar" aria-hidden="true">{{ initials() }}</span>
          <span class="meta">
            <span class="name">{{ user.firstName }} {{ user.lastName }}</span>
            <span class="email">{{ user.email }}</span>
          </span>
        </button>
        @if (open()) {
          <div class="menu" role="menu" [id]="menuId" #menu tabindex="-1" (keydown)="onMenuKeyDown($event)">
            <a routerLink="/settings/profile" role="menuitem" tabindex="-1" class="item" (click)="close(false)">{{ labels.profile }}</a>
            <a routerLink="/settings/security" role="menuitem" tabindex="-1" class="item" (click)="close(false)">{{ labels.security }}</a>
            <a routerLink="/settings/sessions" role="menuitem" tabindex="-1" class="item" (click)="close(false)">{{ labels.sessions }}</a>
            @if (user.role === 'ADMIN') {
              <a routerLink="/admin" role="menuitem" tabindex="-1" class="item" (click)="close(false)">{{ labels.admin }}</a>
            }
            <button type="button" role="menuitem" tabindex="-1" class="item danger" (click)="signOut()">{{ labels.signOut }}</button>
          </div>
        }
      </div>
    }
  `,
})
export class ProfileDropdownComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly labels = {
    profile: FR.nav.profile,
    security: FR.nav.security,
    sessions: FR.nav.sessions,
    admin: FR.nav.admin,
    signOut: FR.common.signOut,
  };
  protected readonly open = signal(false);
  protected readonly menuId = `mtr-profile-menu-${++nextMenuId}`;
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  protected readonly initials = computed(() => {
    const user = this.auth.user();
    return user ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() : '';
  });

  constructor() {
    const onDocClick = (e: MouseEvent) => {
      if (!this.root()?.nativeElement.contains(e.target as Node)) this.open.set(false);
    };
    document.addEventListener('mousedown', onDocClick);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('mousedown', onDocClick));

    afterRenderEffect(() => {
      if (this.open()) this.menu()?.nativeElement.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
  }

  protected close(restoreFocus: boolean): void {
    this.open.set(false);
    if (restoreFocus) this.trigger()?.nativeElement.focus();
  }

  protected onTriggerKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' && !this.open()) {
      e.preventDefault();
      this.open.set(true);
    }
  }

  protected onMenuKeyDown(e: KeyboardEvent): void {
    const items = Array.from(this.menu()?.nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(items.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        this.close(true);
        break;
      case 'Tab':
        this.close(false);
        break;
      default:
        break;
    }
  }

  protected async signOut(): Promise<void> {
    this.open.set(false);
    await this.auth.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
