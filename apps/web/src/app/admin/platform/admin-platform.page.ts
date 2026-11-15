import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { AdminPlatformApi } from '../../core/api/admin-platform-api';
import { describeApiError } from '../../core/api/errors';
import { WORKSPACE_PRIMITIVES } from '../../shared/workspace/workspace.components';

@Component({
  selector: 'mtr-admin-platform-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  templateUrl: './admin-platform.page.html',
})
export class AdminPlatformPage {
  private readonly api = inject(AdminPlatformApi);
  private destroyed = false;
  protected readonly error = signal<string | null>(null);
  protected readonly supervision = signal<{ title: string; modules: { id: string; label: string; status: string }[]; note: string } | null>(null);
  protected readonly markets = signal<{ instruments: Record<string, unknown>[]; description: string } | null>(null);
  protected readonly learning = signal<{ missions: { slug: string; title: string; availability: string; level: string }[]; stats: Record<string, number> } | null>(null);
  protected readonly news = signal<{ items: { title: string; publishedAt: string; symbol: string | null }[]; source: { description: string } } | null>(null);
  protected readonly ai = signal<{ title?: string; models?: { id: string; title: string }[]; disclaimer?: string } | null>(null);
  protected readonly stress = signal<Record<string, unknown> | null>(null);
  protected readonly actuarial = signal<{ title: string; modules: { id: string; label: string; status: string }[]; note: string } | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [supervision, markets, learning, news, ai, stress, actuarial] = await Promise.all([
        this.api.supervision(),
        this.api.markets(),
        this.api.learning(),
        this.api.news(),
        this.api.ai(),
        this.api.stress(),
        this.api.actuarial(),
      ]);
      if (this.destroyed) return;
      this.supervision.set(supervision);
      this.markets.set(markets);
      this.learning.set(learning);
      this.news.set(news);
      this.ai.set(ai as { title?: string; models?: { id: string; title: string }[]; disclaimer?: string });
      this.stress.set(stress);
      this.actuarial.set(actuarial);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Impossible de charger la supervision.'));
    }
  }
}
