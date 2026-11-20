import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../core/api/errors';
import { RoomsApi, type RoomSummary } from '../core/api/rooms-api';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';

@Component({
  selector: 'mtr-rooms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, FormsModule, RouterLink],
  host: { style: 'display: contents' },
  templateUrl: './rooms.page.html',
  styles: [
    `
      .rm-grid {
        display: grid;
        gap: 1.25rem;
        grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
      }
      @media (max-width: 900px) {
        .rm-grid {
          grid-template-columns: 1fr;
        }
      }
      .rm-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.5rem;
      }
      .rm-card {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: center;
        padding: 0.85rem 1rem;
        border: 1px solid color-mix(in srgb, var(--border, #1e3a5f) 55%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, var(--surface, #0b1c33) 88%, transparent);
      }
      .rm-meta {
        opacity: 0.8;
        font-size: 0.9rem;
      }
      .rm-balances {
        display: grid;
        gap: 0.65rem;
      }
      .rm-balance {
        padding: 0.75rem 0.9rem;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--border, #1e3a5f) 40%, transparent);
      }
      .rm-form {
        display: grid;
        gap: 0.75rem;
      }
      .rm-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: end;
      }
      .rm-steps {
        counter-reset: rm-step;
        display: grid;
        gap: 0.35rem;
        margin: 0 0 1.1rem;
        padding: 0 0 0.85rem;
        border-bottom: 1px solid color-mix(in srgb, var(--mtr-border) 55%, transparent);
      }
      .rm-steps span {
        display: block;
        padding: 0;
        border: 0;
        border-radius: 0;
        font-size: 0.8125rem;
        line-height: 1.4;
        color: var(--mtr-text-2);
      }
      .rm-steps span::before {
        content: counter(rm-step) '. ';
        counter-increment: rm-step;
        color: var(--mtr-text-3);
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class RoomsPage {
  private readonly api = inject(RoomsApi);
  private readonly router = inject(Router);
  private destroyed = false;

  protected readonly rooms = signal<RoomSummary[]>([]);
  protected readonly disclaimer = signal('');
  protected readonly steps = signal<string[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected title = 'Salle d’apprentissage';
  protected mode: 'LEARNING' | 'COMPETITION' | 'CLASSROOM' | 'PRACTICE' = 'LEARNING';
  protected visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC';
  protected joinCode = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const res = await this.api.list();
      if (this.destroyed) return;
      this.rooms.set(res.rooms);
      this.disclaimer.set(res.disclaimer);
      const steps = (res.onboarding?.['steps'] as string[]) ?? [];
      this.steps.set(steps);
      this.error.set(null);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Impossible de charger les salles.'));
    }
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const room = await this.api.create({
        title: this.title.trim() || 'Salle de marché',
        mode: this.mode,
        visibility: this.visibility,
        rules: { marketScope: 'FICTIONAL', initialCapital: 100000 },
      });
      this.notice.set(`Salle créée. Code d’invitation : ${room.code}`);
      await this.router.navigate(['/rooms', room.id]);
    } catch (err) {
      this.error.set(describeApiError(err, 'Création impossible.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async join(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const room = await this.api.join({ code: this.joinCode.trim().toUpperCase() });
      this.notice.set(`Vous avez rejoint « ${room.title} ».`);
      await this.router.navigate(['/rooms', room.id]);
    } catch (err) {
      this.error.set(describeApiError(err, 'Impossible de rejoindre la salle.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected statusLabel(status: string): string {
    switch (status) {
      case 'LOBBY':
        return 'En attente';
      case 'ACTIVE':
        return 'En cours';
      case 'PAUSED':
        return 'En pause';
      case 'ENDED':
        return 'Terminée';
      default:
        return status;
    }
  }
}
