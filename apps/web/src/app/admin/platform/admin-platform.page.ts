import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminPlatformApi } from '../../core/api/admin-platform-api';
import { describeApiError } from '../../core/api/errors';
import { displayApiModuleLabel, displayApiStatus } from '../../core/i18n/api-display-labels';
import { WORKSPACE_PRIMITIVES } from '../../shared/workspace/workspace.components';

@Component({
  selector: 'mtr-admin-platform-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, FormsModule],
  host: { style: 'display: contents' },
  templateUrl: './admin-platform.page.html',
})
export class AdminPlatformPage {
  private readonly api = inject(AdminPlatformApi);
  private destroyed = false;
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly supervision = signal<{
    title: string;
    modules: { id: string; label: string; status: string }[];
    note: string;
    stats?: Record<string, unknown>;
  } | null>(null);
  protected readonly markets = signal<{
    instruments: Record<string, unknown>[];
    description: string;
    writable?: boolean;
    instrumentCount?: number;
    fictionalCount?: number;
    historicalCount?: number;
    warehouse?: Record<string, unknown>;
    importBatches?: Record<string, unknown>[];
    sources?: Record<string, unknown>[];
  } | null>(null);
  protected readonly learning = signal<{
    missions: { slug: string; title: string; availability: string; level: string; adminDisabled?: boolean }[];
    stats: Record<string, number>;
    progression?: Record<string, unknown>;
  } | null>(null);
  protected readonly news = signal<{
    items: { id?: string; title: string; publishedAt: string; symbol: string | null; adminManaged?: boolean }[];
    source: { description: string };
  } | null>(null);
  protected readonly ai = signal<{
    title?: string;
    models?: { id: string; title: string; adminDisabled?: boolean }[];
    disclaimer?: string;
  } | null>(null);
  protected readonly stress = signal<{
    presets?: { id: string; name: string; adminDisabled?: boolean }[];
  } | null>(null);
  protected readonly actuarial = signal<{
    title: string;
    modules: { id: string; label: string; status: string }[];
    note: string;
  } | null>(null);
  protected readonly challenges = signal<{
    challenges: { id: string; title: string; open?: boolean; startingCapital?: number }[];
    note?: string;
  } | null>(null);
  protected readonly simulation = signal<Record<string, unknown> | null>(null);

  protected newsTitle = '';
  protected newsSummary = '';
  protected newsSymbol = '';
  protected challengeTitle = '';
  protected challengeCapital = 100000;
  protected depthScalePct = 100;
  protected newsPaused = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [supervision, markets, learning, news, ai, stress, actuarial, challenges, simulation] = await Promise.all([
        this.api.supervision(),
        this.api.markets(),
        this.api.learning(),
        this.api.news(),
        this.api.ai(),
        this.api.stress(),
        this.api.actuarial(),
        this.api.challenges(),
        this.api.simulation(),
      ]);
      if (this.destroyed) return;
      this.supervision.set({
        ...supervision,
        modules: supervision.modules.map((m) => ({
          ...m,
          label: displayApiModuleLabel(m.label),
          status: displayApiStatus(m.status),
        })),
      });
      this.markets.set(markets);
      this.learning.set(learning);
      this.news.set(news);
      this.ai.set(ai as { title?: string; models?: { id: string; title: string; adminDisabled?: boolean }[]; disclaimer?: string });
      this.stress.set(stress as { presets?: { id: string; name: string; adminDisabled?: boolean }[] });
      this.actuarial.set({
        ...actuarial,
        modules: actuarial.modules.map((m) => ({
          ...m,
          label: displayApiModuleLabel(m.label),
          status: displayApiStatus(m.status),
        })),
      });
      this.challenges.set(challenges);
      this.simulation.set(simulation);
      this.newsPaused = Boolean(simulation['newsPaused']);
      this.depthScalePct = Number(simulation['depthScalePct'] ?? 100);
      this.error.set(null);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Impossible de charger la supervision.'));
    }
  }

  private async run(action: () => Promise<unknown>, ok: string): Promise<void> {
    this.busy.set(true);
    this.notice.set(null);
    this.error.set(null);
    try {
      await action();
      this.notice.set(ok);
      await this.load();
    } catch (err) {
      this.error.set(describeApiError(err, 'Action administrateur refusee.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleInstrument(symbol: string, current: string): void {
    const next = current === 'HALTED' ? 'ACTIVE' : 'HALTED';
    void this.run(() => this.api.setInstrumentStatus(symbol, next), `Instrument ${symbol} → ${next}.`);
  }

  protected toggleMission(slug: string, disabled: boolean): void {
    void this.run(() => this.api.setMissionDisabled(slug, !disabled), `Mission ${slug} mise a jour.`);
  }

  protected toggleAi(id: string, disabled: boolean): void {
    void this.run(() => this.api.setAiDisabled(id, !disabled), `Modele ${id} mis a jour.`);
  }

  protected toggleStress(id: string, disabled: boolean): void {
    void this.run(() => this.api.setStressDisabled(id, !disabled), `Scenario ${id} mis a jour.`);
  }

  protected publishNews(): void {
    if (this.newsTitle.trim().length < 8) {
      this.error.set('Le titre doit contenir au moins 8 caracteres.');
      return;
    }
    void this.run(async () => {
      await this.api.publishNews({
        title: this.newsTitle.trim(),
        summary: this.newsSummary.trim() || undefined,
        symbol: this.newsSymbol.trim() || undefined,
      });
      this.newsTitle = '';
      this.newsSummary = '';
      this.newsSymbol = '';
    }, 'Actualite publiee.');
  }

  protected removeNews(id: string): void {
    void this.run(() => this.api.deleteNews(id), 'Actualite retiree.');
  }

  protected createChallenge(): void {
    if (this.challengeTitle.trim().length < 3) {
      this.error.set('Titre de defi trop court.');
      return;
    }
    void this.run(async () => {
      await this.api.createChallenge({
        title: this.challengeTitle.trim(),
        startingCapital: this.challengeCapital,
      });
      this.challengeTitle = '';
    }, 'Defi cree.');
  }

  protected saveSimulation(): void {
    void this.run(
      () => this.api.updateSimulation({ newsPaused: this.newsPaused, depthScalePct: this.depthScalePct }),
      'Parametres de simulation enregistres.',
    );
  }
}