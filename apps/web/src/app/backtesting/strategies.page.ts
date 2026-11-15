import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BACKTEST_STRATEGIES, BacktestApi } from '../core/api/backtest-api';
import { describeApiError } from '../core/api/errors';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';

@Component({
  selector: 'mtr-strategies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  templateUrl: './strategies.page.html',
})
export class StrategiesPage {
  private readonly api = inject(BacktestApi);
  protected readonly catalog = BACKTEST_STRATEGIES;
  protected readonly remote = signal<{ id: string; title: string; description: string }[] | null>(null);
  protected readonly note = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.api
      .strategies()
      .then((body) => {
        this.remote.set(body.strategies);
        this.note.set(body.note);
      })
      .catch((err) => this.error.set(describeApiError(err, 'Impossible de charger le catalogue de stratégies.')));
  }
}
