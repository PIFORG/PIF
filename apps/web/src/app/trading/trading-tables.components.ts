import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { CashEntryView, ExecutionView, OrderView, PositionView } from '../core/api/trading-api';
import { EmptyStateComponent } from '../shared/workspace/workspace.components';
import { dateTime, dt, pct, price, units } from './trading-format';
import { OrderStatusBadgeComponent, SignedAmountComponent } from './trading-parts.components';

/** apps/web/src/components/trading/tables.tsx */

const SIDE_LABEL = { BUY: 'Achat', SELL: 'Vente' } as const;
const TYPE_LABEL = { MARKET: 'Au marché', LIMIT: 'À cours limité', STOP: 'Stop-loss' } as const;

@Component({
  selector: 'mtr-positions-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent, SignedAmountComponent],
  host: { style: 'display: contents' },
  template: `
    @if (positions().length === 0) {
      <div mtr-empty-state icon="portfolio" heading="Aucune position pour l'instant" description="Achetez un instrument et il apparaîtra ici, valorisé au cours mid actuel."></div>
    } @else {
      <div class="table-wrap tr-rows">
        <table class="data-table">
          <caption class="sr-only">Positions ouvertes, valorisées au cours mid</caption>
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col" class="num">Unités</th>
              <th scope="col" class="num">Coût moyen</th>
              <th scope="col" class="num">Mid</th>
              <th scope="col" class="num">Valeur</th>
              <th scope="col" class="num">P&amp;L latent</th>
              <th scope="col" class="num">Poids</th>
              @if (tradable()) {
                <th scope="col"><span class="sr-only">Actions</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (position of positions(); track position.symbol) {
              <tr>
                <th scope="row">
                  <strong>{{ position.symbol }}</strong>
                  <div class="field-hint">{{ position.name }}</div>
                </th>
                <td class="num">{{ units(position.quantity) }}</td>
                <td class="num">{{ price(position.averageCost) }}</td>
                <td class="num">{{ price(position.price) }}</td>
                <td class="num">{{ dt(position.marketValue) }}</td>
                <td class="num">
                  <span mtr-signed-amount [value]="position.unrealizedPnl"></span>
                  @if (position.unrealizedPct !== null) {
                    <div class="field-hint">{{ pct(position.unrealizedPct, true) }}</div>
                  }
                </td>
                <td class="num">{{ pct(position.weight) }}</td>
                @if (tradable()) {
                  <td>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="trade.emit({ symbol: position.symbol, side: 'SELL' })">Vendre<span class="sr-only"> {{ position.symbol }}</span></button>
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class PositionsTableComponent {
  readonly positions = input.required<PositionView[]>();
  /** Shows the per-row Sell action (the Next.js `onTrade` prop). */
  readonly tradable = input(false);
  readonly trade = output<{ symbol: string; side: 'BUY' | 'SELL' }>();
  protected readonly units = units;
  protected readonly price = price;
  protected readonly dt = dt;
  protected readonly pct = pct;
}

@Component({
  selector: 'mtr-orders-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent, OrderStatusBadgeComponent],
  host: { style: 'display: contents' },
  template: `
    @if (orders().length === 0) {
      <div mtr-empty-state icon="trading" [heading]="emptyTitle()" [description]="emptyDescription()"></div>
    } @else {
      <div class="table-wrap tr-rows">
        <table class="data-table">
          <caption class="sr-only">Ordres</caption>
          <thead>
            <tr>
              <th scope="col">Ordre</th>
              <th scope="col" class="num">Exécuté / unités</th>
              <th scope="col">Prix</th>
              <th scope="col" class="num">Cours moyen</th>
              <th scope="col">Statut</th>
              <th scope="col">Soumis</th>
              @if (cancellable()) {
                <th scope="col"><span class="sr-only">Actions</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (order of orders(); track order.id) {
              <tr>
                <th scope="row">
                  <strong>{{ sideLabel[order.side] }} {{ order.symbol }}</strong>
                  <div class="field-hint">{{ typeLabel[order.type] }}</div>
                </th>
                <td class="num">{{ units(order.filledQuantity) }} / {{ units(order.quantity) }}</td>
                <td>{{ orderPrice(order) }}</td>
                <td class="num">{{ price(order.averagePrice) }}</td>
                <td>
                  <span mtr-order-status [status]="order.status" [filled]="order.filledQuantity"></span>
                  @if (order.statusReason) {
                    <div class="field-hint">{{ order.statusReason }}</div>
                  }
                  @if (working(order) && order.expiresAt) {
                    <div class="field-hint">Expire {{ dateTime(order.expiresAt) }}</div>
                  }
                </td>
                <td>{{ dateTime(order.submittedAt) }}</td>
                @if (cancellable()) {
                  <td>
                    @if (working(order)) {
                      <button type="button" class="btn btn-ghost btn-sm" [disabled]="cancelling() === order.id" (click)="cancelOrder.emit(order)">{{ cancelling() === order.id ? 'Annulation…' : 'Annuler' }}<span class="sr-only"> {{ sideLabel[order.side] }} {{ order.symbol }}</span></button>
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class OrdersTableComponent {
  readonly orders = input.required<OrderView[]>();
  /** Affiche l'action Annuler sur les ordres en cours. */
  readonly cancellable = input(false);
  readonly cancelling = input<string | null>(null);
  readonly emptyTitle = input('Aucun ordre');
  readonly emptyDescription = input<string | undefined>(undefined);
  readonly cancelOrder = output<OrderView>();

  protected readonly sideLabel = SIDE_LABEL;
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly units = units;
  protected readonly price = price;
  protected readonly dateTime = dateTime;

  protected working(order: OrderView): boolean {
    return order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED';
  }

  protected orderPrice(order: OrderView): string {
    if (order.type === 'MARKET') return 'Meilleur prix';
    if (order.type === 'LIMIT') return `Limite ${price(order.limitPrice)}`;
    if (order.type === 'STOP') return `Stop ${price(order.stopPrice)}${order.triggered ? ' · déclenché' : ''}`;
    return 'Meilleur prix';
  }
}

@Component({
  selector: 'mtr-trades-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent, SignedAmountComponent],
  host: { style: 'display: contents' },
  template: `
    @if (executions().length === 0) {
      <div mtr-empty-state icon="clock" heading="Aucune transaction pour l'instant" description="Chaque exécution est enregistrée ici avec son prix, ses frais et son impact sur la trésorerie."></div>
    } @else {
      <div class="table-wrap tr-rows">
        <table class="data-table">
          <caption class="sr-only">Transactions exécutées</caption>
          <thead>
            <tr>
              <th scope="col">Transaction</th>
              <th scope="col" class="num">Unités</th>
              <th scope="col" class="num">Prix</th>
              <th scope="col" class="num">Frais</th>
              <th scope="col" class="num">P&amp;L réalisé</th>
              <th scope="col" class="num">Impact trésorerie</th>
              <th scope="col">Exécutée</th>
            </tr>
          </thead>
          <tbody>
            @for (execution of executions(); track execution.id) {
              <tr>
                <th scope="row"><strong>{{ sideLabel[execution.side] }} {{ execution.symbol }}</strong></th>
                <td class="num">{{ units(execution.quantity) }}</td>
                <td class="num">{{ price(execution.price) }}</td>
                <td class="num">{{ dt(execution.fee) }}</td>
                <td class="num">
                  @if (execution.realizedPnl === null) {
                    {{ dash }}
                  } @else {
                    <span mtr-signed-amount [value]="execution.realizedPnl"></span>
                  }
                </td>
                <td class="num"><span mtr-signed-amount [value]="execution.cashImpact"></span></td>
                <td>{{ dateTime(execution.executedAt) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class TradesTableComponent {
  readonly executions = input.required<ExecutionView[]>();
  protected readonly sideLabel = SIDE_LABEL;
  protected readonly dash = '\u2014';
  protected readonly units = units;
  protected readonly price = price;
  protected readonly dt = dt;
  protected readonly dateTime = dateTime;
}

const ENTRY_LABEL: Record<CashEntryView['type'], string> = {
  DEPOSIT: 'Dépôt',
  WITHDRAWAL: 'Retrait',
  BUY: 'Achat',
  SELL: 'Vente',
};

@Component({
  selector: 'mtr-cash-ledger-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent, SignedAmountComponent],
  host: { style: 'display: contents' },
  template: `
    @if (entries().length === 0) {
      <div mtr-empty-state icon="bank" heading="Aucun mouvement de trésorerie"></div>
    } @else {
      <div class="table-wrap tr-rows">
        <table class="data-table">
          <caption class="sr-only">Grand livre de trésorerie</caption>
          <thead>
            <tr>
              <th scope="col">Mouvement</th>
              <th scope="col" class="num">Montant</th>
              <th scope="col" class="num">Solde après</th>
              <th scope="col">Quand</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of entries(); track entry.id) {
              <tr>
                <th scope="row">
                  <strong>{{ entryLabel[entry.type] }}</strong>
                  <div class="field-hint">{{ entry.description }}</div>
                </th>
                <td class="num"><span mtr-signed-amount [value]="entry.amount"></span></td>
                <td class="num">{{ dt(entry.balanceAfter) }}</td>
                <td>{{ dateTime(entry.occurredAt) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class CashLedgerTableComponent {
  readonly entries = input.required<CashEntryView[]>();
  protected readonly entryLabel = ENTRY_LABEL;
  protected readonly dt = dt;
  protected readonly dateTime = dateTime;
}
