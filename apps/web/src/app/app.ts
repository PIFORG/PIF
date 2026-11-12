import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';

@Component({
  selector: 'mtr-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  host: { style: 'display: contents' },
  template: `<router-outlet />`,
})
export class App {
  constructor() {
    // Starts the session restore immediately, as AuthProvider does at the root of apps/web.
    inject(AuthService);
  }
}
