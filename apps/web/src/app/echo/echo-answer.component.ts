import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { EchoAction, EchoAnswer } from '../core/echo/echo-api';
import { COLUMN_LABELS, STATUS_LABELS, cell, evidenceValue } from './echo-format';

/** One structured ÉCHO answer: text, risk flags, evidence by kind, scenario table, chart, provenance, actions. */
@Component({
  selector: 'mtr-echo-answer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './echo-panel.component.css',
  template: `
    @let a = answer();
    @if (statusLabel()) {
      <p class="ec-status" [attr.data-status]="a.status">{{ statusLabel() }}</p>
    }
    <p class="ec-text">{{ a.answer }}</p>

    @if (a.riskFlags.length) {
      <ul class="ec-flags" aria-label="Points de vigilance">
        @for (f of a.riskFlags; track $index) {
          <li [attr.data-severity]="f.severity">
            <span class="ec-sev">{{ severityLabel[f.severity] }}</span>{{ f.message }}
          </li>
        }
      </ul>
    }

    @if (a.clarification?.options?.length) {
      <div class="ec-chips" role="group" [attr.aria-label]="a.clarification!.question">
        @for (o of a.clarification!.options; track $index) {
          <button type="button" class="ec-chip" (click)="choose.emit({ label: o.label, message: o.message, context: o.context })">
            {{ o.label }}
          </button>
        }
      </div>
    }

    @if (a.scenario?.rows?.length) {
      <figure class="ec-scenario">
        <figcaption>
          {{ a.scenario!.label }}
          @if (a.scenario!.hypothetical) { <span class="ec-tag">Hypothétique</span> }
        </figcaption>
        <div class="ec-tableWrap">
          <table>
            <thead>
              <tr>
                @for (c of columns(); track c) { <th scope="col">{{ columnLabel(c) }}</th> }
              </tr>
            </thead>
            <tbody>
              @for (r of a.scenario!.rows; track $index) {
                <tr>
                  @for (c of columns(); track c) {
                    @if (c === 'label') { <th scope="row">{{ r[c] }}</th> } @else { <td>{{ cell(c, r[c]) }}</td> }
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (a.scenario!.assumptions?.length) {
          <p class="ec-note">Hypothèses : {{ a.scenario!.assumptions!.join(' ') }}</p>
        }
      </figure>
    }

    @if (chart(); as c) {
      <figure class="ec-chart">
        <figcaption>{{ c.title }}</figcaption>
        <svg [attr.viewBox]="'0 0 ' + c.w + ' ' + c.h" role="img" [attr.aria-label]="c.summary" preserveAspectRatio="none">
          @if (c.type === 'line') {
            <polyline [attr.points]="c.line" fill="none" class="ec-line" />
          } @else {
            @for (b of c.bars; track $index) {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" class="ec-bar"><title>{{ b.label }}</title></rect>
            }
          }
        </svg>
        <p class="ec-axis"><span>{{ c.first }}</span><span>{{ c.last }}</span></p>
      </figure>
    }

    @if (a.evidence.length) {
      <dl class="ec-evidence">
        @for (e of a.evidence; track $index) {
          <div>
            <dt><span class="ec-kind" [attr.data-kind]="e.kind">{{ e.kindLabel }}</span>{{ e.label }}</dt>
            <dd>{{ value(e) }} @if (e.source) { <small>{{ e.source }}</small> }</dd>
          </div>
        }
      </dl>
    }

    @if (a.limitations.length || a.sources.length || a.dataAsOf) {
      <button type="button" class="ec-link" [attr.aria-expanded]="showProvenance()" (click)="showProvenance.set(!showProvenance())">
        {{ showProvenance() ? 'Masquer' : 'Voir' }} la provenance et les limites
      </button>
      @if (showProvenance()) {
        <div class="ec-prov">
          @if (a.dataAsOf) { <p>Données au {{ a.dataAsOf.slice(0, 10) }}.</p> }
          @for (s of a.sources; track $index) {
            <p><strong>{{ s.module }}</strong> — {{ s.method }}@if (s.provenance?.['description']) {. {{ s.provenance!['description'] }}}</p>
          }
          @if (a.toolsUsed.length) { <p>Outils : {{ a.toolsUsed.join(', ') }} · moteur {{ a.engine }}</p> }
          <ul>
            @for (l of a.limitations; track $index) { <li>{{ l }}</li> }
          </ul>
        </div>
      }
    }

    @if (a.suggestedActions.length) {
      <div class="ec-chips">
        @for (act of a.suggestedActions; track $index) {
          <button type="button" class="ec-chip" [class.ec-chipNav]="act.kind === 'NAVIGATE'" (click)="action.emit(act)">
            {{ act.label }}
          </button>
        }
      </div>
    }
  `,
})
export class EchoAnswerComponent {
  readonly answer = input.required<EchoAnswer>();
  readonly action = output<EchoAction>();
  readonly choose = output<{ label: string; message?: string; context?: Record<string, unknown> }>();
  protected readonly showProvenance = signal(false);
  protected readonly severityLabel: Record<string, string> = { INFO: 'Info', WARNING: 'Attention', CRITICAL: 'Bloquant' };
  protected readonly value = evidenceValue;
  protected readonly cell = cell;
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.answer().status] ?? '');

  protected readonly columns = computed(() => {
    const rows = this.answer().scenario?.rows ?? [];
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) if (k in COLUMN_LABELS && r[k] !== null && typeof r[k] !== 'object') keys.add(k);
    return ['label', ...[...keys].filter((k) => k !== 'label')];
  });

  protected columnLabel(c: string): string {
    return COLUMN_LABELS[c] ?? c;
  }

  /** Inline SVG from server points only; no chart is drawn without at least two real points. */
  protected readonly chart = computed(() => {
    const v = this.answer().visualization;
    if (!v || v.points.length < 2) return null;
    const w = 320;
    const h = 96;
    const ys = v.points.map((p) => Number(p.y)).filter((y) => Number.isFinite(y));
    if (ys.length < 2) return null;
    const min = Math.min(...ys, v.type === 'bar' ? 0 : Infinity);
    const max = Math.max(...ys);
    const span = max - min || 1;
    const fmt = (x: string | number) => String(x).slice(0, 10);
    const summary = `${v.title} : ${v.points.length} points, de ${fmt(v.points[0].x)} à ${fmt(v.points[v.points.length - 1].x)}.`;
    if (v.type === 'line') {
      const line = v.points
        .map((p, i) => `${((i / (v.points.length - 1)) * w).toFixed(1)},${(h - ((Number(p.y) - min) / span) * (h - 6) - 3).toFixed(1)}`)
        .join(' ');
      return { type: 'line' as const, w, h, line, bars: [], title: v.title, summary, first: fmt(v.points[0].x), last: fmt(v.points[v.points.length - 1].x) };
    }
    const bw = w / v.points.length;
    const bars = v.points.map((p, i) => {
      const bh = Math.max(1, ((Number(p.y) - min) / span) * (h - 4));
      return { x: i * bw + 2, y: h - bh, w: Math.max(2, bw - 4), h: bh, label: `${p.x} : ${Number(p.y).toFixed(3)}` };
    });
    return { type: 'bar' as const, w, h, line: '', bars, title: v.title, summary, first: fmt(v.points[0].x), last: fmt(v.points[v.points.length - 1].x) };
  });
}
