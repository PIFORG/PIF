import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MarketApi, type AssetClass, type InstrumentView, type MarketSnapshot, type MarketStatus } from '../core/api/trading-api';
import { IconComponent } from '../shared/icon/icon.component';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { dateTime, describeTradingError, dt, price, sectorLabel, shortTime, units } from './trading-format';
import { ProvenanceNoteComponent, SignedAmountComponent } from './trading-parts.components';

const REFRESH_MS = 30_000;

/** The best/worst KPI: the change (a ratio) and its hint. Movers are filtered to a known change. */
function mover(instrument: InstrumentView | undefined): { change: number; hint: string } | null {
  if (!instrument || instrument.changePct === null) return null;
  return { change: instrument.changePct / 100, hint: `${instrument.symbol} · ${instrument.name}` };
}

@Component({
  selector: 'mtr-instrument-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, SignedAmountComponent],
  host: { style: 'display: contents' },
  template: `
    <div class="table-wrap tr-rows tr-blotterTable">
      <table class="data-table">
        <caption class="sr-only">{{ caption() }}</caption>
        <thead>
          <tr>
            <th scope="col"><span class="sr-only">Suivi</span></th>
            <th scope="col">Instrument</th>
            <th scope="col" class="num">Bid</th>
            <th scope="col" class="num">Ask</th>
            <th scope="col" class="num">Mid</th>
            <th scope="col" class="num">Variation</th>
            <th scope="col" class="num">Spread</th>
            <th scope="col" class="num">Clôture</th>
            <th scope="col" class="num">Profondeur</th>
            <th scope="col" class="num">Frais</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          @for (i of instruments(); track i.symbol) {
            <tr [attr.data-status]="i.status">
              <td>
                <button
                  type="button"
                  class="tr-watchToggle"
                  [attr.aria-pressed]="watched().has(i.symbol)"
                  [attr.aria-label]="(watched().has(i.symbol) ? 'Retirer ' : 'Ajouter ') + i.symbol + (watched().has(i.symbol) ? ' de la liste de suivi' : ' à la liste de suivi')"
                  (click)="toggleWatch.emit(i.symbol)"
                >
                  <svg mtrIcon name="star" [size]="16" />
                </button>
              </td>
              <th scope="row">
                <span class="tr-symbolLine">
                  <strong>{{ i.symbol }}</strong>
                  @if (i.status === 'HALTED') {
                    <span class="badge badge-danger">Suspendu</span>
                  }
                </span>
                <div class="field-hint">{{ i.name }} · {{ i.assetClass === 'FUND' ? 'Fonds' : 'Action' }} · {{ sectorLabel(i.sector) }}</div>
              </th>
              <td class="num">{{ price(i.quote?.bid) }}</td>
              <td class="num">{{ price(i.quote?.ask) }}</td>
              <td class="num tr-mid">{{ price(i.quote?.mid) }}</td>
              <td class="num">
                @if (i.changePct === null) {
                  {{ dash }}
                } @else {
                  <span mtr-signed-amount [value]="i.changePct / 100" kind="pct"></span>
                }
              </td>
              <td class="num">{{ i.quote ? i.quote.spreadBps.toFixed(1) + ' bps' : dash }}</td>
              <td class="num">{{ price(i.previousClose) }}</td>
              <td class="num">{{ i.quote ? units(i.quote.depth) : dash }}</td>
              <td class="num">{{ (i.fees.feeBps / 100).toFixed(2) }} %</td>
              <td>
                <a routerLink="/trading" [queryParams]="{ symbol: i.symbol }" class="btn btn-ghost btn-sm">Négocier<span class="sr-only"> {{ i.symbol }}</span></a>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class InstrumentTableComponent {
  readonly instruments = input.required<InstrumentView[]>();
  readonly watched = input.required<Set<string>>();
  readonly caption = input.required<string>();
  readonly toggleWatch = output<string>();
  protected readonly price = price;
  protected readonly sectorLabel = sectorLabel;
  protected readonly units = units;
  protected readonly dash = '\u2014';
}

/** /markets: apps/web/src/components/trading/MarketsOverview.tsx */
@Component({
  selector: 'mtr-markets-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    PageHeadingComponent,
    HeadingActionsSlot,
    ...WORKSPACE_PRIMITIVES,
    ProvenanceNoteComponent,
    SignedAmountComponent,
    InstrumentTableComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './markets.page.html',
})
export class MarketsPage {
  private readonly api = inject(MarketApi);
  private destroyed = false;

  protected readonly status = signal<MarketStatus | null>(null);
  protected readonly market = signal<MarketSnapshot | null>(null);
  protected readonly watched = signal<Set<string>>(new Set());
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly assetClass = signal<'ALL' | AssetClass>('ALL');
  protected readonly sector = signal('ALL');

  protected readonly dash = '\u2014';
  protected readonly dateTime = dateTime;
  protected readonly sectorLabel = sectorLabel;

  protected readonly sectors = computed(() =>
    [...new Set((this.market()?.instruments ?? []).map((i) => i.sector))].sort((a, b) => a.localeCompare(b, 'fr')),
  );
  protected readonly visible = computed(() => {
    const text = this.query().trim().toLowerCase();
    const assetClass = this.assetClass();
    const sector = this.sector();
    return (this.market()?.instruments ?? []).filter(
      (i) =>
        (assetClass === 'ALL' || i.assetClass === assetClass) &&
        (sector === 'ALL' || i.sector === sector) &&
        (!text || i.symbol.toLowerCase().includes(text) || i.name.toLowerCase().includes(text) || i.sector.toLowerCase().includes(text)),
    );
  });
  protected readonly watchlist = computed(() => (this.market()?.instruments ?? []).filter((i) => this.watched().has(i.symbol)));
  private readonly movers = computed(() =>
    [...(this.market()?.instruments ?? [])]
      .filter((i) => i.changePct !== null)
      .sort((x, y) => (y.changePct ?? 0) - (x.changePct ?? 0)),
  );
  protected readonly best = computed(() => mover(this.movers()[0]));
  protected readonly worst = computed(() => mover(this.movers()[this.movers().length - 1]));
  protected readonly instrumentCount = computed(() => {
    const market = this.market();
    return market ? units(market.instruments.length) : '\u2026';
  });
  protected readonly quotePeriod = computed(() => {
    const status = this.status();
    return status ? `${status.quotePeriodSeconds / 60} min` : '\u2026';
  });
  protected readonly periodHint = computed(() => {
    const period = this.status()?.currentPeriod;
    return period ? `Période en cours ${shortTime(period.start)}–${shortTime(period.end)}` : undefined;
  });
  protected readonly feeSummary = computed(() =>
    (['EQUITY', 'FUND'] as AssetClass[])
      .map((cls) => this.market()?.instruments.find((i) => i.assetClass === cls))
      .filter((i): i is InstrumentView => !!i)
      .map((i) => `${i.assetClass === 'FUND' ? 'Fonds' : 'Actions'} ${(i.fees.feeBps / 100).toFixed(2)} % (min ${dt(i.fees.minFee)})`)
      .join(' · '),
  );

  constructor() {
    void this.load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.load();
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      window.clearInterval(timer);
    });
  }

  protected async load(): Promise<void> {
    try {
      const [status, data, watchlist] = await Promise.all([this.api.status(), this.api.instruments(), this.api.watchlist()]);
      if (this.destroyed) return;
      this.status.set(status);
      this.market.set(data);
      this.watched.set(new Set(watchlist.items.map((item) => item.instrument.symbol)));
      this.error.set(null);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeTradingError(err, 'Les données de marché n\'ont pas pu être chargées.'));
    }
  }

  protected async toggleWatch(symbol: string): Promise<void> {
    try {
      const { items } = this.watched().has(symbol) ? await this.api.unwatch(symbol) : await this.api.watch(symbol);
      if (!this.destroyed) this.watched.set(new Set(items.map((item) => item.instrument.symbol)));
    } catch (err) {
      if (!this.destroyed) this.error.set(describeTradingError(err, 'La liste de suivi n\'a pas pu être mise à jour.'));
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected setAssetClass(event: Event): void {
    this.assetClass.set(this.value(event) as 'ALL' | AssetClass);
  }

  protected setSector(event: Event): void {
    this.sector.set(this.value(event));
  }
}
