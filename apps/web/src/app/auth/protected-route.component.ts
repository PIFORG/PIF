import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, TemplateRef, computed, contentChild, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import type { UserRole, UserStatus } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { buildLoginHref } from '../core/auth/return-to';

/**
 * Counterpart of apps/web ProtectedRoute: "Checking session…" while restoring, then redirect or render.
 * The guarded content must be an `<ng-template>`: projected `<ng-content>` (and any routed page inside it)
 * is instantiated — and starts loading data — even when it is never displayed.
 */
@Component({
  selector: 'mtr-protected-route',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  host: { style: 'display: contents' },
  template: `
    @if (auth.status() === 'loading') {
      <div class="page-shell" role="status" aria-live="polite">
        <p>Checking session…</p>
      </div>
    } @else if (allowed()) {
      <ng-container [ngTemplateOutlet]="content()" />
    }
  `,
})
export class ProtectedRouteComponent {
  protected readonly content = contentChild.required(TemplateRef);
  readonly roles = input<UserRole[] | undefined>(undefined);
  readonly allowStatuses = input<UserStatus[]>(['ACTIVE', 'PENDING_VERIFICATION', 'PENDING_DELETION']);
  readonly requireEmailVerified = input(false);

  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly allowed = computed(() => {
    const user = this.auth.user();
    if (!user) return false;
    if (!this.allowStatuses().includes(user.status)) return false;
    if (this.requireEmailVerified() && !user.emailVerified) return false;
    const roles = this.roles();
    return !(roles && !roles.includes(user.role));
  });

  constructor() {
    effect(() => {
      const status = this.auth.status();
      const user = this.auth.user();
      if (status === 'loading') return;

      if (status === 'unauthenticated' || !user) {
        void this.router.navigateByUrl(buildLoginHref(this.router.url.split('#')[0]), { replaceUrl: true });
        return;
      }
      if (!this.allowStatuses().includes(user.status)) {
        void this.router.navigateByUrl('/unauthorized', { replaceUrl: true });
        return;
      }
      if (this.requireEmailVerified() && !user.emailVerified) {
        void this.router.navigateByUrl('/resend-verification', { replaceUrl: true });
        return;
      }
      const roles = this.roles();
      if (roles && !roles.includes(user.role)) {
        void this.router.navigateByUrl('/unauthorized', { replaceUrl: true });
      }
    });
  }
}
