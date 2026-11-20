import '../../styles/lazy-actuarial';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ActuarialApi } from '../core/api/actuarial-api';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { tnd } from './actuarial-format';
import { ActuarialTabsComponent, EstimateNoteComponent, describeActuarialError } from './actuarial-parts.components';

@Component({
  selector: 'mtr-alm-studio-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeadingComponent, ...WORKSPACE_PRIMITIVES, ActuarialTabsComponent, EstimateNoteComponent],
  host: { style: 'display: contents' },
  templateUrl: './alm-studio.page.html',
})
export class AlmStudioPage {
  private readonly api = inject(ActuarialApi);
  private destroyed = false;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<Record<string, unknown> | null>(null);
  protected readonly tnd = tnd;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.loadDemo();
  }

  protected async loadDemo(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = await this.api.almDemo();
      if (!this.destroyed) this.result.set(res);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeActuarialError(err, 'Le scénario ALM n’a pas pu être chargé.'));
    } finally {
      if (!this.destroyed) this.busy.set(false);
    }
  }

  protected num(obj: unknown, key: string): number | null {
    if (!obj || typeof obj !== 'object') return null;
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : null;
  }

  protected text(key: string): string {
    const v = this.result()?.[key];
    return typeof v === 'string' ? v : '';
  }

  protected side(key: 'assets' | 'liabilities'): Record<string, unknown> | null {
    const v = this.result()?.[key];
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  }
}
