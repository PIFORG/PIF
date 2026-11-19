import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, inject, signal } from '@angular/core';
import { NewsApi, type NewsFeed } from '../../core/api/news-api';
import { describeApiError } from '../../core/api/errors';

interface WireItem {
  id: string;
  title: string;
  sector: string;
  provenance: string;
  pedagogical: boolean;
}

@Component({
  selector: 'mtr-financial-news-wire',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: '../market-pulse/market-pulse.component.css',
  host: { class: 'nw-root', role: 'region', 'aria-label': 'Fil d\'actualités financières' },
  template: `
    <div class="nw-bar">
      <span class="nw-label">Actualités</span>
      <span class="nw-source" [title]="sourceTitle()">{{ sourceChip() }}</span>

      @if (error()) {
        <p class="nw-error" role="status">{{ error() }}</p>
      } @else if (loading() && items().length === 0) {
        <p class="nw-loading" role="status">Chargement…</p>
      } @else if (items().length === 0) {
        <p class="nw-empty" role="status">Aucun titre disponible.</p>
      } @else {
        <div
          class="nw-viewport"
          tabindex="0"
          (mouseenter)="paused.set(true)"
          (mouseleave)="onHoverLeave()"
          (focusin)="paused.set(true)"
          (focusout)="onFocusOut($event)"
        >
          <div class="nw-track" [class.nw-paused]="paused() || reduceMotion()">
            <div class="nw-seq">
              @for (item of items(); track item.id) {
                <button type="button" class="nw-item" (click)="select(item.id)" [attr.aria-expanded]="selected() === item.id">
                  <span class="nw-sector">{{ item.sector }}</span>
                  <span class="nw-title">{{ item.title }}</span>
                </button>
              }
            </div>
            @if (!reduceMotion()) {
              <div class="nw-seq" aria-hidden="true">
                @for (item of items(); track item.id + '-dup') {
                  <span class="nw-item">
                    <span class="nw-sector">{{ item.sector }}</span>
                    <span class="nw-title">{{ item.title }}</span>
                  </span>
                }
              </div>
            }
          </div>
        </div>

        <ul class="sr-only">
          @for (item of items(); track 'sr-' + item.id) {
            <li>{{ item.sector }} — {{ item.title }}@if (item.pedagogical) { (scénario pédagogique)}</li>
          }
        </ul>
      }

      <button
        type="button"
        class="nw-pause"
        (click)="togglePause()"
        [attr.aria-pressed]="paused()"
        [attr.aria-label]="paused() ? 'Reprendre le défilement des actualités' : 'Mettre en pause le défilement des actualités'"
      >
        {{ paused() ? 'Reprendre' : 'Pause' }}
      </button>
    </div>

    @if (selectedItem(); as detail) {
      <div class="nw-detail" role="dialog" aria-label="Détail de l'actualité">
        <div class="nw-detailInner">
          <p class="nw-detailMeta">
            <span>{{ detail.sector }}</span>
            @if (detail.pedagogical) {
              <span class="nw-tag">Scénario pédagogique simulé</span>
            }
          </p>
          <p class="nw-detailTitle">{{ detail.title }}</p>
          <p class="nw-detailSummary">{{ detail.summary }}</p>
          <button type="button" class="btn btn-ghost btn-sm" (click)="selected.set(null)">Fermer</button>
        </div>
      </div>
    }
  `,
})
export class FinancialNewsWireComponent {
  private readonly api = inject(NewsApi);
  private destroyed = false;
  private feed: NewsFeed | null = null;
  private userPaused = false;

  protected readonly items = signal<WireItem[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly paused = signal(false);
  protected readonly reduceMotion = signal(false);
  protected readonly selected = signal<string | null>(null);
  protected readonly selectedItem = signal<{
    title: string;
    summary: string;
    sector: string;
    pedagogical: boolean;
  } | null>(null);

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => (this.destroyed = true));

    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reduceMotion.set(mq.matches);
      const onMq = () => this.reduceMotion.set(mq.matches);
      mq.addEventListener('change', onMq);
      destroyRef.onDestroy(() => mq.removeEventListener('change', onMq));
    } catch {
      // ignore
    }

    void this.refresh();
    const timer = window.setInterval(() => void this.refresh(), 120_000);
    destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  protected sourceChip(): string {
    const kind = this.feed?.source.kind ?? '';
    if (kind.includes('SYNTHETIC') || kind.includes('PEDAGOGICAL') || kind === 'FICTIONAL') return 'Données pédagogiques';
    return this.feed?.source.id ? `Source · ${this.feed.source.id}` : 'Fil marché';
  }

  protected sourceTitle(): string {
    return this.feed?.source.description ?? 'Fil d\'actualités pédagogiques';
  }

  protected select(id: string): void {
    const raw = this.feed?.items.find((i) => i.id === id);
    if (!raw) return;
    this.selected.set(id);
    this.selectedItem.set({
      title: raw.title,
      summary: raw.summary,
      sector: raw.sector,
      pedagogical: isPedagogical(raw.provenance),
    });
    this.paused.set(true);
  }

  protected togglePause(): void {
    this.userPaused = !this.userPaused;
    this.paused.set(this.userPaused);
  }

  protected onHoverLeave(): void {
    if (!this.userPaused) this.paused.set(false);
  }

  protected onFocusOut(event: FocusEvent): void {
    const root = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    if (!next || !root.contains(next)) {
      if (!this.userPaused) this.paused.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try {
      const feed = await this.api.feed();
      if (this.destroyed) return;
      this.feed = feed;
      this.items.set(
        feed.items.map((i) => ({
          id: i.id,
          title: i.title,
          sector: i.sector || 'Marchés',
          provenance: i.provenance,
          pedagogical: isPedagogical(i.provenance) || isPedagogical(feed.source.kind),
        })),
      );
      this.error.set(null);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Actualités indisponibles.'));
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }
}

function isPedagogical(value: string): boolean {
  const v = value.toUpperCase();
  return v.includes('SYNTHETIC') || v.includes('PEDAGOGICAL') || v.includes('FICTIONAL') || v.includes('SIMUL');
}
