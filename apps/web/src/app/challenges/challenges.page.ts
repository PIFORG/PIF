import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ChallengesApi, type ChallengeDetail, type ChallengeSummary } from '../core/api/challenges-api';
import { describeApiError } from '../core/api/errors';
import { AuthService } from '../core/auth/auth.service';
import { formatMoney, formatNumber } from '../core/format/finance';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';

@Component({
  selector: 'mtr-challenges-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  templateUrl: './challenges.page.html',
})
export class ChallengesPage {
  private readonly api = inject(ChallengesApi);
  private readonly auth = inject(AuthService);
  private destroyed = false;

  protected readonly list = signal<ChallengeSummary[]>([]);
  protected readonly note = signal<string | null>(null);
  protected readonly selected = signal<ChallengeDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly equity = signal('112000');
  protected readonly title = signal('');
  protected readonly formatMoney = formatMoney;
  protected readonly formatNumber = formatNumber;
  protected readonly isAdmin = () => this.auth.user()?.role === 'ADMIN';

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const res = await this.api.list();
      if (this.destroyed) return;
      this.list.set(res.challenges);
      this.note.set(res.note);
      if (res.challenges[0]) await this.open(res.challenges[0].id);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Impossible de charger les defis.'));
    }
  }

  protected async open(id: string): Promise<void> {
    try {
      const detail = await this.api.detail(id);
      if (!this.destroyed) this.selected.set(detail);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Impossible de charger le defi.'));
    }
  }

  protected async join(): Promise<void> {
    const id = this.selected()?.id;
    if (!id) return;
    try {
      this.selected.set(await this.api.join(id));
    } catch (err) {
      this.error.set(describeApiError(err, 'Inscription au defi impossible.'));
    }
  }

  protected async submit(): Promise<void> {
    const id = this.selected()?.id;
    if (!id) return;
    const value = Number(this.equity());
    if (!Number.isFinite(value)) {
      this.error.set('Saisissez des fonds propres finaux numeriques.');
      return;
    }
    try {
      this.selected.set(await this.api.submit(id, value));
    } catch (err) {
      this.error.set(describeApiError(err, 'Soumission impossible.'));
    }
  }

  protected async create(): Promise<void> {
    try {
      await this.api.create({ title: this.title() });
      this.title.set('');
      await this.reload();
    } catch (err) {
      this.error.set(describeApiError(err, 'Creation du defi refusee.'));
    }
  }
}