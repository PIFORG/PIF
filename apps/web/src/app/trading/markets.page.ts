import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import '../../styles/lazy-trading';
import { NewsApi, type NewsFeed } from '../core/api/news-api';
import { MarketApi, type AssetClass, type InstrumentView, type MarketSnapshot, type MarketStatus } from '../core/api/trading-api';
import { IconComponent } from '../shared/icon/icon.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import {
  assetClassLabel,
  assetClassLabelPlural,
  dateTime,
  describeTradingError,
  dt,
  price,
  sectorLabel,
  shortTime,
  units,
} from './trading-format';
import { SignedAmountComponent } from './trading-parts.components';

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
                  @if (i.fictional === false) {
                    <span class="badge">Historique</span>
                  }
                  @if (i.tradable === false) {
                    <span class="badge">Indice</span>
                  }
                </span>
                <div class="field-hint">
                  {{ i.name }} · {{ assetClassLabel(i.assetClass) }} · {{ sectorLabel(i.sector) }}
                  @if (i.market) {
                    · {{ i.market }}
                  }
                  @if (i.coverage?.to) {
                    · dernière {{ i.coverage!.to }}
                  }
                </div>
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
                @if (i.tradable === false) {
                  <a routerLink="/backtesting" [queryParams]="{ symbol: i.symbol }" class="btn btn-ghost btn-sm">Historique<span class="sr-only"> {{ i.symbol }}</span></a>
                } @else {
                  <a routerLink="/trading" [queryParams]="{ symbol: i.symbol }" class="btn btn-ghost btn-sm">Négocier<span class="sr-only"> {{ i.symbol }}</span></a>
                }
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
  protected readonly assetClassLabel = assetClassLabel;
  protected readonly units = units;
  protected readonly dash = '\u2014';
}

/** /markets: apps/web/src/components/trading/MarketsOverview.tsx */
@Component({
  selector: 'mtr-markets-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ...WORKSPACE_PRIMITIVES, SignedAmountComponent, InstrumentTableComponent],
  host: { style: 'display: contents' },
  templateUrl: './markets.page.html',
})
export class MarketsPage {
  private readonly api = inject(MarketApi);
  private readonly newsApi = inject(NewsApi);
  private destroyed = false;

  protected readonly status = signal<MarketStatus | null>(null);
  protected readonly market = signal<MarketSnapshot | null>(null);
  protected readonly watched = signal<Set<string>>(new Set());
  protected readonly news = signal<NewsFeed | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly assetClass = signal<'ALL' | AssetClass>('ALL');
  protected readonly sector = signal('ALL');
  protected readonly marketFilter = signal<'ALL' | 'TN' | 'US'>('ALL');
  protected readonly kindFilter = signal<'ALL' | 'HISTORICAL' | 'FICTIONAL'>('ALL');
  protected readonly pageSize = signal(100);

  protected readonly dash = '\u2014';
  protected readonly dateTime = dateTime;
  protected readonly dt = dt;
  protected readonly price = price;
  protected readonly sectorLabel = sectorLabel;

  protected readonly sectors = computed(() =>
    [...new Set((this.market()?.instruments ?? []).map((i) => i.sector))].sort((a, b) => a.localeCompare(b, 'fr')),
  );
  protected readonly filtered = computed(() => {
    const text = this.query().trim().toLowerCase();
    const assetClass = this.assetClass();
    const sector = this.sector();
    const market = this.marketFilter();
    const kind = this.kindFilter();
    return (this.market()?.instruments ?? []).filter((i) => {
      if (assetClass !== 'ALL' && i.assetClass !== assetClass) return false;
      if (sector !== 'ALL' && i.sector !== sector) return false;
      if (market !== 'ALL' && (i.market ?? '') !== market) return false;
      if (kind === 'HISTORICAL' && i.fictional !== false) return false;
      if (kind === 'FICTIONAL' && i.fictional !== true) return false;
      if (
        text &&
        !i.symbol.toLowerCase().includes(text) &&
        !i.name.toLowerCase().includes(text) &&
        !i.sector.toLowerCase().includes(text)
      ) {
        return false;
      }
      return true;
    });
  });
  /** Paginated view of filtered instruments (full catalog remains searchable). */
  protected readonly visible = computed(() => this.filtered().slice(0, this.pageSize()));
  protected readonly hasMore = computed(() => this.filtered().length > this.pageSize());
  protected readonly pageLede = computed(() => {
    const snap = this.market();
    const st = this.status();
    if (!snap) return 'Chargement du référentiel…';
    const hist = snap.instruments.filter((i) => i.fictional === false).length;
    const fict = snap.instruments.length - hist;
    const kinds = st?.provenance.kind === 'HISTORICAL' || hist > 0
      ? `${hist} historique${hist > 1 ? 's' : ''} · ${fict} fictif${fict > 1 ? 's' : ''}`
      : 'Univers pédagogique fictif';
    return `${kinds} · clôtures datées (pas de live)`;
  });
  protected readonly newsLabel = computed(() => {
    const feed = this.news();
    if (!feed) return '';
    if (feed.availability === 'WAREHOUSE_FR' || feed.availability === 'WAREHOUSE' || (feed.realNewsCount ?? 0) > 0) {
      return 'Actualités';
    }
    if (feed.availability === 'PAUSED_BY_ADMIN') return 'En pause';
    return 'Pédagogiques';
  });
  protected readonly watchlist = computed(() => (this.market()?.instruments ?? []).filter((i) => this.watched().has(i.symbol)));
  private readonly movers = computed(() =>
    [...(this.market()?.instruments ?? [])]
      .filter((i) => i.changePct !== null && Math.abs(i.changePct!) <= 40)
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
    (['EQUITY', 'FUND', 'BOND', 'COMMODITY', 'FX'] as AssetClass[])
      .map((cls) => this.market()?.instruments.find((i) => i.assetClass === cls))
      .filter((i): i is InstrumentView => !!i)
      .map((i) => `${assetClassLabelPlural(i.assetClass)} ${(i.fees.feeBps / 100).toFixed(2)} % (min ${dt(i.fees.minFee)})`)
      .join(' · '),
  );
  protected readonly fundamentalsSymbol = signal('CTB');
  protected readonly fundamentals = signal<{
    company: string;
    statements: Record<string, number>;
    ratios: Record<string, number | null>;
    provenance: { description: string };
    limitations: string[];
  } | null>(null);

  constructor() {
    void this.load();
    void this.loadFundamentals('CTB');
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
      const [status, data, watchlist, news] = await Promise.all([
        this.api.status(),
        this.api.instruments(),
        this.api.watchlist(),
        this.newsApi.feed().catch(() => null),
      ]);
      if (this.destroyed) return;
      this.status.set(status);
      this.market.set(data);
      this.watched.set(new Set(watchlist.items.map((item) => item.instrument.symbol)));
      if (news) this.news.set(news);
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
    this.pageSize.set(100);
  }

  protected setSector(event: Event): void {
    this.sector.set(this.value(event));
    this.pageSize.set(100);
  }

  protected setMarketFilter(event: Event): void {
    this.marketFilter.set(this.value(event) as 'ALL' | 'TN' | 'US');
    this.pageSize.set(100);
  }

  protected setKindFilter(event: Event): void {
    this.kindFilter.set(this.value(event) as 'ALL' | 'HISTORICAL' | 'FICTIONAL');
    this.pageSize.set(100);
  }

  protected async loadFundamentals(symbol: string): Promise<void> {
    this.fundamentalsSymbol.set(symbol);
    try {
      const data = await this.api.fundamentals(symbol);
      if (!this.destroyed) this.fundamentals.set(data);
    } catch {
      if (!this.destroyed) this.fundamentals.set(null);
    }
  }
}
