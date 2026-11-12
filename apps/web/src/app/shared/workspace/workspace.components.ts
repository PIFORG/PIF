import { ChangeDetectionStrategy, Component, Directive, computed, contentChild, input } from '@angular/core';
import { directionOf, formatPercent, formatSignedMoney } from '../../core/format/finance';
import { FR } from '../../core/i18n/fr';
import { STATUS_LABEL, type RouteStatus } from '../../core/navigation/workspace-nav';
import { IconComponent, type IconName } from '../icon/icon.component';

/**
 * apps/web/src/components/workspace/primitives.tsx. Attribute selectors keep the styled element (section, div, span)
 * as the host, so the markup and the ported workspace.css match the Next.js output element for element.
 */

const STATUS_ICON: Record<RouteStatus, IconName> = {
  LIVE_INTEGRATED: 'check',
  DEMO_EXPLICITLY_LABELLED: 'flask',
  DESIGNED_PENDING_BACKEND: 'clock',
};

const STATUS_TITLE: Record<RouteStatus, string> = {
  LIVE_INTEGRATED: 'Connecté à l\'API MTRS',
  DEMO_EXPLICITLY_LABELLED: 'Affiche uniquement des données d\'exemple identifiées',
  DESIGNED_PENDING_BACKEND: 'Écran conçu ; le moteur de ce module n\'est pas encore disponible',
};

@Component({
  selector: 'span[mtr-status-badge]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'ws-status', '[attr.data-status]': 'status()', '[attr.title]': 'title()' },
  template: `<svg mtrIcon [name]="icon()" [size]="12" />{{ label() }}`,
})
export class StatusBadgeComponent {
  readonly status = input.required<RouteStatus>();
  protected readonly icon = computed(() => STATUS_ICON[this.status()]);
  protected readonly title = computed(() => STATUS_TITLE[this.status()]);
  protected readonly label = computed(() =>
    this.status() === 'DESIGNED_PENDING_BACKEND' ? FR.status.previewBackendPending : STATUS_LABEL[this.status()],
  );
}

/** Marks any surface that renders sample fixtures. Always visible, never colour-only. */
@Component({
  selector: 'span[mtr-demo-label]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'ws-demo' },
  template: `<svg mtrIcon name="flask" [size]="12" /><ng-content>Données d'exemple</ng-content>`,
})
export class DemoModeLabelComponent {}

/* ---------- Panel ---------- */

@Directive({ selector: '[mtrPanelActions]' })
export class PanelActionsSlot {}

@Component({
  selector: 'section[mtr-panel]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ws-panel',
    '[attr.id]': 'panelId() ?? null',
    '[attr.data-demo]': "demo() ? 'true' : null",
    '[attr.aria-labelledby]': 'headingId()',
  },
  template: `
    <div class="ws-panelHead">
      <div class="ws-panelTitles">
        <div class="ws-panelTitleRow">
          <h2 class="ws-panelTitle" [attr.id]="headingId()">{{ heading() }}</h2>
          <ng-content select="[mtrPanelBadge]" />
        </div>
        @if (description()) {
          <p class="ws-panelDescription">{{ description() }}</p>
        }
      </div>
      @if (actions()) {
        <div class="ws-panelActions"><ng-content select="[mtrPanelActions]" /></div>
      }
    </div>
    <ng-content />
  `,
})
export class PanelComponent {
  readonly heading = input.required<string>();
  readonly description = input<string | null | undefined>(undefined);
  readonly panelId = input<string | undefined>(undefined);
  /** Visually marks the panel as sample content. */
  readonly demo = input(false);
  protected readonly actions = contentChild(PanelActionsSlot);
  protected readonly headingId = computed(() => (this.panelId() ? `${this.panelId()}-title` : null));
}

/* ---------- KPI ---------- */

@Directive({ selector: '[mtrKpiChange]' })
export class KpiChangeSlot {}

/** A rich hint; the projected element carries class="ws-kpiHint" itself. */
@Directive({ selector: '[mtrKpiHint]' })
export class KpiHintSlot {}

@Component({
  selector: 'div[mtr-kpi]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'ws-kpi', '[attr.data-tone]': 'tone()' },
  template: `
    <div class="ws-kpiTop">
      <span class="ws-kpiLabel">{{ label() }}</span>
      @if (icon(); as name) {
        <svg mtrIcon class="ws-kpiIcon" [name]="name" [size]="16" />
      }
    </div>
    <div class="ws-kpiValue"><ng-content /></div>
    @if (change() || hint() || richHint()) {
      <div class="ws-kpiFoot">
        <ng-content select="[mtrKpiChange]" />
        @if (hint()) {
          <span class="ws-kpiHint">{{ hint() }}</span>
        }
        <ng-content select="[mtrKpiHint]" />
      </div>
    }
  `,
})
export class KpiCardComponent {
  readonly label = input.required<string>();
  readonly icon = input<IconName | undefined>(undefined);
  readonly hint = input<string | null | undefined>(undefined);
  readonly tone = input<'default' | 'positive' | 'negative' | 'warning'>('default');
  protected readonly change = contentChild(KpiChangeSlot);
  protected readonly richHint = contentChild(KpiHintSlot);
}

/* ---------- Signed change (never colour-only) ---------- */

@Component({
  selector: 'span[mtr-change]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'ws-change num', '[attr.data-direction]': 'direction()' },
  template: `@if (direction() !== 'flat') {<svg mtrIcon [name]="direction() === 'up' ? 'arrow-up' : 'arrow-down'" [size]="12" />}<span aria-hidden="true">{{ text() }}</span><span class="sr-only">{{ spoken() }} {{ unsigned() }}</span>`,
})
export class ChangeComponent {
  readonly value = input.required<number>();
  readonly kind = input<'percent' | 'money'>('percent');
  readonly currency = input<string | undefined>(undefined);
  protected readonly direction = computed(() => directionOf(this.value()));
  protected readonly text = computed(() =>
    this.kind() === 'percent' ? formatPercent(this.value(), { signed: true }) : formatSignedMoney(this.value(), this.currency()),
  );
  protected readonly spoken = computed(() =>
    this.direction() === 'up' ? 'up' : this.direction() === 'down' ? 'down' : 'unchanged',
  );
  protected readonly unsigned = computed(() => this.text().replace(/^[+\u2212]/, ''));
}

/* ---------- Empty / error states ---------- */

@Directive({ selector: '[mtrEmptyAction]' })
export class EmptyActionSlot {}

@Component({
  selector: 'div[mtr-empty-state]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'ws-empty', '[attr.data-tone]': 'tone()', '[attr.role]': "tone() === 'error' ? 'alert' : null" },
  template: `
    <span class="ws-emptyIcon"><svg mtrIcon [name]="tone() === 'error' ? 'alert' : icon()" [size]="20" /></span>
    <p class="ws-emptyTitle">{{ heading() }}</p>
    @if (description()) {
      <p class="ws-emptyText">{{ description() }}</p>
    }
    @if (action()) {
      <div class="ws-emptyAction"><ng-content select="[mtrEmptyAction]" /></div>
    }
  `,
})
export class EmptyStateComponent {
  readonly icon = input<IconName>('info');
  readonly heading = input.required<string>();
  readonly description = input<string | null | undefined>(undefined);
  readonly tone = input<'default' | 'error'>('default');
  protected readonly action = contentChild(EmptyActionSlot);
}

@Component({
  selector: 'div[mtr-panel-skeleton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ws-skeletonStack', 'aria-hidden': 'true' },
  template: `@for (i of indices(); track i) {<span class="skeleton" [style.height.px]="14" [style.width.%]="88 - i * 14"></span>}`,
})
export class PanelSkeletonComponent {
  readonly rows = input(3);
  protected readonly indices = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}

export const WORKSPACE_PRIMITIVES = [
  StatusBadgeComponent,
  DemoModeLabelComponent,
  PanelComponent,
  PanelActionsSlot,
  KpiCardComponent,
  KpiChangeSlot,
  KpiHintSlot,
  ChangeComponent,
  EmptyStateComponent,
  EmptyActionSlot,
  PanelSkeletonComponent,
] as const;
