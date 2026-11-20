import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MarketApi, type InstrumentView, type MarketSnapshot } from '../../core/api/trading-api';
import { describeApiError } from '../../core/api/errors';
import { SignedAmountComponent } from '../../trading/trading-parts.components';

export interface PulseItem {
  symbol: string;
  label: string;
  mid: number | null;
  changePct: number | null;
  decimals: number;
}

@Component({
  selector: 'mtr-market-pulse',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink, SignedAmountComponent],
  styleUrl: './market-pulse.component.css',
  host: { class: 'mp-root', role: 'region', 'aria-label': 'Bandeau de cotations simulées' },
  template: `
    <div class="mp-bar">
      <span class="mp-source" [title]="sourceTitle()">
        {{ sourceLabel() }}
        @if (asOf()) {
          <time class="mp-asOf" [attr.datetime]="asOf()">· {{ asOfLabel() }}</time>
        }
      </span>

      @if (error()) {
        <p class="mp-error" role="status">{{ error() }}</p>
      } @else if (loading() && items().length === 0) {
        <p class="mp-loading" role="status">Chargement des cotations…</p>
      } @else if (items().length === 0) {
        <p class="mp-empty" role="status">Aucune cotation disponible.</p>
      } @else {
        <div
          class="mp-viewport"
          tabindex="0"
          (mouseenter)="paused.set(true)"
          (mouseleave)="onHoverLeave()"
          (focusin)="paused.set(true)"
          (focusout)="onFocusOut($event)"
        >
          <div class="mp-track" [class.mp-paused]="paused() || reduceMotion()">
            <div class="mp-seq">
              @for (item of items(); track item.symbol) {
                <a class="mp-item" [routerLink]="['/trading']" [queryParams]="{ symbol: item.symbol }">
                  <span class="mp-sym">{{ item.symbol }}</span>
                  <span class="mp-sep" aria-hidden="true"></span>
                  <span class="mp-px num">{{ formatMid(item) }}</span>
                  <span class="mp-sep" aria-hidden="true"></span>
                  @if (item.changePct !== null) {
                    <span mtr-signed-amount [value]="item.changePct / 100" kind="pct"></span>
                  } @else {
                    <span class="mp-na">—</span>
                  }
                </a>
              }
            </div>
            @if (!reduceMotion()) {
              <div class="mp-seq" aria-hidden="true">
                @for (item of items(); track item.symbol + '-dup') {
                  <span class="mp-item">
                    <span class="mp-sym">{{ item.symbol }}</span>
                    <span class="mp-sep" aria-hidden="true"></span>
                    <span class="mp-px num">{{ formatMid(item) }}</span>
                    <span class="mp-sep" aria-hidden="true"></span>
                    @if (item.changePct !== null) {
                      <span mtr-signed-amount [value]="item.changePct / 100" kind="pct"></span>
                    } @else {
                      <span class="mp-na">—</span>
                    }
                  </span>
                }
              </div>
            }
          </div>
        </div>

        <ul class="sr-only" aria-live="polite">
          @for (item of items(); track 'sr-' + item.symbol) {
            <li>
              {{ item.symbol }} {{ item.label }}
              {{ formatMid(item) }}
              @if (item.changePct !== null) {
                , variation {{ item.changePct > 0 ? '+' : '' }}{{ item.changePct.toFixed(2) }} %
              }
            </li>
          }
        </ul>
      }

      <button
        type="button"
        class="mp-pause"
        (click)="togglePause()"
        [attr.aria-pressed]="paused()"
        [attr.aria-label]="paused() ? 'Reprendre le défilement des cotations' : 'Mettre en pause le défilement des cotations'"
      >
        {{ paused() ? 'Reprendre' : 'Pause' }}
      </button>
      <a class="mp-link" routerLink="/markets">Marchés</a>
    </div>
  `,
})
export class MarketPulseComponent {
  private readonly api = inject(MarketApi);
  private destroyed = false;
  private userPaused = false;

  protected readonly items = signal<PulseItem[]>([]);
  protected readonly asOf = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly paused = signal(false);
  protected readonly reduceMotion = signal(false);
  protected readonly historicalCount = signal(0);
  protected readonly sourceLabel = computed(() => 'Marché');
  protected readonly sourceTitle = computed(() =>
    this.historicalCount() > 0
      ? 'Cotations de la base (dernières clôtures) — pas un cours en direct.'
      : 'Cotations pédagogiques du serveur de simulation.',
  );

  protected readonly asOfLabel = computed(() => {
    const raw = this.asOf();
    if (!raw) return '';
    try {
      return new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(raw));
    } catch {
      return raw;
    }
  });

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
      // Media query unavailable.
    }

    void this.refresh();
    const timer = window.setInterval(() => void this.refresh(), 60_000);
    destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  protected formatMid(item: PulseItem): string {
    if (item.mid === null) return '—';
    return item.mid.toLocaleString('fr-FR', {
      minimumFractionDigits: Math.min(2, item.decimals),
      maximumFractionDigits: item.decimals,
    });
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
      const snap = await this.api.instruments();
      if (this.destroyed) return;
      const historical = snap.instruments.filter(
        (i) => !i.fictional && (i.dataKind === 'HISTORICAL' || !!i.quote),
      );
      this.historicalCount.set(historical.filter((i) => !!i.quote).length);
      this.items.set(this.toItems(snap));
      this.asOf.set(snap.asOf);
      this.error.set(null);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Cotations indisponibles.'));
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }

  private toItems(snap: MarketSnapshot): PulseItem[] {
    const withQuote = snap.instruments.filter(
      (i) => (i.quote || i.changePct !== null) && (i.quote?.mid === undefined || i.quote?.mid === null || i.quote.mid > 0),
    );
    // Prefer Tunisian / TND names so the tape reads in a French local-market context.
    const tn = withQuote.filter(
      (i) => i.market === 'TN' || i.currency === 'TND' || (!i.fictional && i.dataKind === 'HISTORICAL' && i.currency === 'TND'),
    );
    const historical = withQuote.filter((i) => !i.fictional || i.dataKind === 'HISTORICAL');
    const pool = tn.length >= 8 ? tn : historical.length >= 8 ? historical : withQuote;
    // Prefer credible session moves; fall back to price-bearing quotes if few remain.
    const credible = pool.filter((i) => i.changePct !== null && Math.abs(i.changePct) <= 40);
    const rankedSource = credible.length >= 8 ? credible : pool.filter((i) => i.quote?.mid);
    const ranked = [...rankedSource].sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
    const ordered = ranked.length ? ranked : snap.instruments;
    return ordered.slice(0, 28).map((i) => this.mapInstrument(i));
  }

  private mapInstrument(i: InstrumentView): PulseItem {
    return {
      symbol: frenchTapeSymbol(i),
      label: shortLabel(i),
      mid: i.quote?.mid ?? null,
      changePct: i.changePct,
      decimals: i.priceDecimals || 2,
    };
  }
}

/** Affiche un libellé lisible (nom) plutôt qu'un ISIN / code technique. */
function frenchTapeSymbol(i: InstrumentView): string {
  const sym = i.symbol?.trim() ?? '';
  const name = i.name?.trim() ?? '';
  const looksIsin = /^[A-Z]{2}[A-Z0-9]{9,}$/i.test(sym) || sym.length > 10;
  if (looksIsin && name) {
    const short = name.replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/\s+/)[0];
    return short || name.slice(0, 12);
  }
  return sym || name;
}

function shortLabel(i: InstrumentView): string {
  if (i.assetClass === 'FX') return 'EUR/TND';
  if (i.assetClass === 'COMMODITY') return i.name.length > 22 ? i.symbol : i.name;
  return i.name.length > 18 ? i.symbol : i.name;
}
