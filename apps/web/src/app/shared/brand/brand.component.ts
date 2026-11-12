import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let nextGradientId = 0;

/**
 * Market Trading Room emblem: a sharp geometric mark holding two volume
 * columns and a market line that traces an "M", ending on a luminous data point.
 * Self-contained colours so it reads on dark and light surfaces from 20 px to 200 px.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- applied to an <svg> so parent styles reach it
  selector: 'svg[mtrEmblem]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    viewBox: '0 0 48 48',
    focusable: 'false',
    '[attr.width]': 'size()',
    '[attr.height]': 'size()',
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-hidden]': 'label() ? null : "true"',
    '[attr.aria-label]': 'label() ?? null',
  },
  template: `
    <svg:defs>
      <svg:linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="1" y2="1">
        <svg:stop offset="0" stop-color="#18325F" />
        <svg:stop offset="1" stop-color="#061126" />
      </svg:linearGradient>
    </svg:defs>
    <svg:rect x="2" y="2" width="44" height="44" rx="8" [attr.fill]="'url(#' + gradientId + ')'" />
    <svg:rect x="2.75" y="2.75" width="42.5" height="42.5" rx="7.25" fill="none" stroke="#83B8FF" stroke-opacity="0.72" stroke-width="1.5" />
    <svg:rect x="13" y="24" width="5" height="12" rx="1" fill="#2556F4" fill-opacity="0.85" />
    <svg:rect x="29" y="20" width="5" height="16" rx="1" fill="#397DFF" fill-opacity="0.9" />
    <svg:path d="M9.5 33 L16 17.5 L23.5 27 L31.5 13.5 L37.5 21" fill="none" stroke="#83B8FF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
    <svg:circle cx="37.5" cy="21" r="3.2" fill="#397DFF" />
    <svg:circle cx="37.5" cy="21" r="1.5" fill="#F5F8FF" />
  `,
})
export class EmblemComponent {
  readonly size = input(32);
  readonly label = input<string | undefined>(undefined);
  protected readonly gradientId = `mtr-emblem-${++nextGradientId}`;
}

@Component({
  selector: 'mtr-brand-lockup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmblemComponent],
  host: { style: 'display: contents' },
  styleUrl: './brand.component.css',
  template: `
    <span class="lockup">
      <svg mtrEmblem [size]="size()"></svg>
      @if (!compact()) {
        <span class="words">
          <span class="name">Market Trading Room</span>
          <span class="descriptor">Simulateur</span>
        </span>
      }
    </span>
  `,
})
export class BrandLockupComponent {
  /** Hide the descriptor line, e.g. in a collapsed sidebar. */
  readonly compact = input(false);
  readonly size = input(32);
}
