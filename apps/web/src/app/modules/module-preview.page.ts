import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FR } from '../core/i18n/fr';
import { IconComponent } from '../shared/icon/icon.component';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { MODULES, type BlueprintKind, type ModuleDefinition } from './module-catalog';

/** Static placeholder shapes (not loading skeletons, not data). */
@Component({
  selector: 'mtr-module-wireframe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @switch (kind()) {
      @case ('chart') {
        <div class="mp-wfChart">
          @for (i of four; track i) {
            <span></span>
          }
        </div>
      }
      @case ('table') {
        <div class="mp-wfTable">
          @for (i of four; track i) {
            <span [attr.data-head]="i === 0 ? 'true' : null"></span>
          }
        </div>
      }
      @case ('kpis') {
        <div class="mp-wfKpis">
          @for (i of three; track i) {
            <span></span>
          }
        </div>
      }
      @case ('heatmap') {
        <div class="mp-wfHeat">
          @for (i of twelve; track i) {
            <span></span>
          }
        </div>
      }
      @case ('form') {
        <div class="mp-wfForm">
          @for (i of three; track i) {
            <span></span>
          }
          <span data-button="true"></span>
        </div>
      }
      @default {
        <div class="mp-wfList">
          @for (i of three; track i) {
            <span></span>
          }
        </div>
      }
    }
  `,
})
export class ModuleWireframeComponent {
  readonly kind = input.required<BlueprintKind>();
  protected readonly three = [0, 1, 2];
  protected readonly four = [0, 1, 2, 3];
  protected readonly twelve = Array.from({ length: 12 }, (_, i) => i);
}

/** Fully disabled ticket; explains why instead of pretending to submit. */
@Component({
  selector: 'form[mtr-order-ticket-preview]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'mp-ticket', 'aria-describedby': 'ticket-disabled', '(submit)': '$event.preventDefault()' },
  template: `
    <fieldset disabled class="mp-ticketFields">
      <legend class="sr-only">Simulated order ticket (disabled)</legend>
      <div class="mp-sides" role="group" aria-label="Side">
        <button type="button" class="mp-side" data-side="buy">Acheter</button>
        <button type="button" class="mp-side" data-side="sell">Vendre</button>
      </div>
      <label class="field">
        <span class="field-label">Instrument</span>
        <input class="input" placeholder="Search a symbol" />
      </label>
      <div class="mp-ticketRow">
        <label class="field">
          <span class="field-label">Order type</span>
          <select class="select">
            <option value="MARKET">Market</option>
            <option value="LIMIT" selected>Limit</option>
            <option value="STOP">Stop</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Quantity</span>
          <input class="input num" inputmode="numeric" placeholder="0" />
        </label>
      </div>
      <label class="field">
        <span class="field-label">Limit price</span>
        <input class="input num" inputmode="decimal" placeholder="0.00" />
      </label>
      <button type="submit" class="btn btn-primary">Review order</button>
    </fieldset>
    <p id="ticket-disabled" class="mp-ticketNote"><svg mtrIcon name="lock" [size]="14" />Disabled: the simulated execution engine is not connected, so no order can be placed yet.</p>
  `,
})
export class OrderTicketPreviewComponent {}

/**
 * apps/web/src/components/workspace/ModulePreviewPage.tsx: an honest "preview · backend pending" screen showing the
 * designed layout, capabilities, concepts and the proposed API contract of a module whose engine does not exist yet.
 * The route passes the catalog slug as `data.module`.
 */
@Component({
  selector: 'mtr-module-preview-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IconComponent,
    PageHeadingComponent,
    HeadingActionsSlot,
    ...WORKSPACE_PRIMITIVES,
    ModuleWireframeComponent,
    OrderTicketPreviewComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './module-preview.page.html',
})
export class ModulePreviewPage {
  /** Set directly in tests; otherwise read from the route data. */
  readonly definition = input<ModuleDefinition | undefined>(undefined);
  private readonly routeModule = inject(ActivatedRoute).snapshot.data['module'] as string | undefined;
  protected readonly module = computed(() => this.definition() ?? MODULES[this.routeModule ?? '']);
  protected readonly backToOverview = FR.modules.backToOverview;
}
