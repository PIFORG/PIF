import { ChangeDetectionStrategy, Component, Directive, contentChild, input } from '@angular/core';
import type { RouteStatus } from '../../core/navigation/workspace-nav';
import { StatusBadgeComponent } from '../workspace/workspace.components';

@Directive({ selector: '[mtrHeadingActions]' })
export class HeadingActionsSlot {}

/** Rich description content (badges, links); rendered inside the heading's description paragraph. */
@Directive({ selector: '[mtrHeadingDescription]' })
export class HeadingDescriptionSlot {}

@Component({
  selector: 'mtr-page-heading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusBadgeComponent],
  host: { style: 'display: contents' },
  styleUrl: './page-heading.component.css',
  template: `
    <header class="heading">
      <div class="headingText">
        @if (eyebrow() || status()) {
          <div class="headingMeta">
            @if (eyebrow()) {
              <span class="eyebrow">{{ eyebrow() }}</span>
            }
            @if (status(); as value) {
              <span mtr-status-badge [status]="value"></span>
            }
          </div>
        }
        <h1 class="title">{{ title() }}</h1>
        @if (description()) {
          <p class="description">{{ description() }}</p>
        } @else if (richDescription()) {
          <p class="description"><ng-content select="[mtrHeadingDescription]" /></p>
        }
      </div>
      @if (actions()) {
        <div class="headingActions"><ng-content select="[mtrHeadingActions]" /></div>
      }
    </header>
  `,
})
export class PageHeadingComponent {
  readonly eyebrow = input<string | undefined>(undefined);
  readonly title = input.required<string>();
  readonly description = input<string | undefined>(undefined);
  readonly status = input<RouteStatus | undefined>(undefined);
  protected readonly actions = contentChild(HeadingActionsSlot);
  protected readonly richDescription = contentChild(HeadingDescriptionSlot);
}
