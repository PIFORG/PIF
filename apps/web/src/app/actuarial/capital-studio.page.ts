import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActuarialApi } from '../core/api/actuarial-api';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { tnd } from './actuarial-format';
import { ActuarialTabsComponent, EstimateNoteComponent, describeActuarialError } from './actuarial-parts.components';

@Component({
  selector: 'mtr-capital-studio-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeadingComponent, ...WORKSPACE_PRIMITIVES, ActuarialTabsComponent, EstimateNoteComponent],
  host: { style: 'display: contents' },
  templateUrl: './capital-studio.page.html',
})
export class CapitalStudioPage {
  private readonly api = inject(ActuarialApi);
  private destroyed = false;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<Record<string, unknown> | null>(null);
  protected readonly tnd = tnd;

  protected intensity = 0.05;
  protected policies = 50;
  protected severityMean = 1000;
  protected severityCv = 0.8;
  protected confidence = 0.995;
  protected horizon = 1;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  protected async run(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = {
        label: 'Capital économique',
        frequency: { family: 'POISSON', policies: this.policies, years: 1, intensity: this.intensity },
        severity: { family: 'GAMMA', mean: this.severityMean, cv: this.severityCv },
        confidenceLevel: this.confidence,
        horizonYears: this.horizon,
      };
      const res = await this.api.economicCapital(body);
      if (!this.destroyed) this.result.set(res);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeActuarialError(err, 'Le capital économique n’a pas pu être calculé.'));
    } finally {
      if (!this.destroyed) this.busy.set(false);
    }
  }

  protected num(key: string): number | null {
    const v = this.result()?.[key];
    return typeof v === 'number' ? v : null;
  }

  protected text(key: string): string {
    const v = this.result()?.[key];
    return typeof v === 'string' ? v : '';
  }
}
