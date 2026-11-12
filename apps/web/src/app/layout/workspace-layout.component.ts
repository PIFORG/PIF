import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ProtectedRouteComponent } from '../auth/protected-route.component';
import { AppShellComponent } from './app-shell/app-shell.component';

/** Signed-in workspace: session check, then the shell around the routed page. */
@Component({
  selector: 'mtr-workspace-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ProtectedRouteComponent, AppShellComponent],
  host: { style: 'display: contents' },
  template: `
    <mtr-protected-route>
      <ng-template>
        <mtr-app-shell>
          <router-outlet />
        </mtr-app-shell>
      </ng-template>
    </mtr-protected-route>
  `,
})
export class WorkspaceLayoutComponent {}
