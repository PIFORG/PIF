import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type {
  Cell,
  ChainLadderResult,
  FactorAverage,
  MethodEstimate,
  ReservingBasis,
  ReservingCatalogue,
  ReservingMethod,
  ReservingResult,
  ReservingRunSummary,
} from '../core/api/actuarial-api';
import { LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { IconComponent } from '../shared/icon/icon.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { count, ratio, tndShort, tndWhole } from './actuarial-format';
import { ColumnChartComponent, NumberFieldComponent, SegmentedComponent, type ActuarialMessage } from './actuarial-parts.components';
import type { ReservingForm, ReservingFormErrors } from './reserving-form';

/* The input forms and result panels of apps/web/src/components/actuarial/ReservingStudio.tsx. */

const DASH = '\u2014';
const RUN_LABEL = /^[\p{L}\p{N} .,'&()%+/–-]{1,80}$/u;
const BASIS_LABEL: Record<ReservingBasis, string> = { PAID: 'Paid', INCURRED: 'Incurred' };
const AVERAGE_LABEL: Record<FactorAverage, string> = { VOLUME_WEIGHTED: 'Volume-weighted', SIMPLE_AVERAGE: 'Simple average', LATEST_DIAGONALS: 'Latest years' };
type TriangleView = 'CUMULATIVE' | 'INCREMENTAL' | 'LINK_RATIOS' | 'COMPLETED';
const VIEW_LABEL: Record<TriangleView, string> = { CUMULATIVE: 'Cumulative', INCREMENTAL: 'Incremental', LINK_RATIOS: 'Link ratios', COMPLETED: 'Completed' };
const BASIS_OPTIONS = [
  { value: 'PAID', label: 'Paid' },
  { value: 'INCURRED', label: 'Incurred' },
] as const;

export type MethodLabels = { id: ReservingMethod; label: string }[];
export type ReservingTextKey = Exclude<keyof ReservingForm, 'selectedPaid' | 'selectedIncurred'>;
export interface ReservingChange {
  key: ReservingTextKey;
  value: string;
}
export interface FactorSelection {
  basis: ReservingBasis;
  index: number;
  value: string;
}

const amount = (value: number | null | undefined) => (value === null || value === undefined ? DASH : count(value));
const factor = (value: number | null | undefined) => (value === null || value === undefined ? DASH : value.toFixed(4));
const signed = (value: number | null | undefined) => (value === null || value === undefined ? DASH : `${value > 0 ? '+' : value < 0 ? '\u2212' : ''}${count(Math.abs(value))}`);

export function methodLabel(labels: MethodLabels, id: ReservingMethod): string {
  return labels.find((m) => m.id === id)?.label ?? id;
}

function pickBasis(results: ReservingResult, basis: ReservingBasis): ChainLadderResult {
  return basis === 'INCURRED' && results.chainLadder.incurred ? results.chainLadder.incurred : results.chainLadder.paid;
}

/* ---------- Inputs ---------- */

@Component({
  selector: 'div[mtr-triangle-field]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'field' },
  template: `
    <label class="field-label" [attr.for]="fieldId()">{{ label() }}</label>
    <textarea
      [id]="fieldId()"
      class="textarea num ac-triangleInput"
      [rows]="rows()"
      spellcheck="false"
      autocomplete="off"
      wrap="off"
      [value]="value()"
      [attr.aria-invalid]="error() ? true : null"
      [attr.aria-describedby]="describedBy()"
      (input)="changed.emit($any($event.target).value)"
    ></textarea>
    <p [id]="fieldId() + '-hint'" class="field-hint">{{ hint() }}</p>
    @if (error()) {
      <p [id]="fieldId() + '-error'" class="field-error">{{ error() }}</p>
    }
  `,
})
export class TriangleFieldComponent {
  readonly fieldId = input.required<string>();
  readonly label = input.required<string>();
  readonly hint = input.required<string>();
  readonly value = input.required<string>();
  readonly error = input<string | undefined>(undefined);
  readonly rows = input.required<number>();
  readonly changed = output<string>();
  protected readonly describedBy = computed(() => [`${this.fieldId()}-hint`, this.error() ? `${this.fieldId()}-error` : null].filter(Boolean).join(' '));
}

@Component({
  selector: 'form[mtr-reserving-data-form]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NumberFieldComponent, TriangleFieldComponent],
  host: { class: 'ac-form', novalidate: '', '(submit)': '$event.preventDefault()' },
  template: `
    <div class="field">
      <label class="field-label" for="rs-example">Example triangle (fictional)</label>
      <select id="rs-example" class="select" (change)="example.emit($any($event.target).value)">
        <option value="" [selected]="exampleId() === ''">Your own data</option>
        @for (e of catalogue().examples; track e.id) {
          <option [value]="e.id" [selected]="e.id === exampleId()">{{ e.name }}</option>
        }
      </select>
      <p class="field-hint">{{ exampleText() ?? 'Edited by you. Pick an example to start again.' }}</p>
    </div>
    <div
      mtr-number-field
      fieldId="rs-first-origin"
      label="First accident year"
      [hint]="catalogue().limits.minOrigins + ' to ' + catalogue().limits.maxOrigins + ' accident years, the latest is the valuation year.'"
      [value]="form().firstOrigin"
      [error]="errors()['firstOrigin']"
      (changed)="set('firstOrigin', $event)"
    ></div>
    <div
      mtr-triangle-field
      fieldId="rs-paid"
      label="Cumulative paid (DT)"
      hint="One line per accident year, oldest first; amounts by development year separated by spaces, tabs or semicolons. Write a missing amount as -; it is left out, never read as zero."
      [rows]="lines()"
      [value]="form().paid"
      [error]="errors()['paid']"
      (changed)="set('paid', $event)"
    ></div>
    <div
      mtr-triangle-field
      fieldId="rs-incurred"
      label="Cumulative incurred (DT, optional)"
      hint="Reported amounts: paid plus case reserves, same layout as paid."
      [rows]="lines()"
      [value]="form().incurred"
      [error]="errors()['incurred']"
      (changed)="set('incurred', $event)"
    ></div>
    <div
      mtr-triangle-field
      fieldId="rs-premiums"
      label="Earned premium by accident year (DT, optional)"
      hint="One amount per accident year, for the expected loss ratio and Bornhuetter–Ferguson methods."
      [rows]="2"
      [value]="form().premiums"
      [error]="errors()['premiums']"
      (changed)="set('premiums', $event)"
    ></div>
  `,
})
export class ReservingDataFormComponent {
  readonly form = input.required<ReservingForm>();
  readonly errors = input.required<ReservingFormErrors>();
  readonly catalogue = input.required<ReservingCatalogue>();
  readonly exampleId = input.required<string>();
  readonly exampleText = input.required<string | null>();
  readonly example = output<string>();
  readonly changed = output<ReservingChange>();
  protected readonly lines = computed(() => Math.min(10, Math.max(4, this.form().paid.split('\n').length)));

  protected set(key: ReservingTextKey, value: string): void {
    this.changed.emit({ key, value });
  }
}

@Component({
  selector: 'form[mtr-reserving-assumptions]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NumberFieldComponent, SegmentedComponent],
  host: { class: 'ac-form', novalidate: '', 'aria-describedby': 'rs-status', '(submit)': '$event.preventDefault()' },
  template: `
    <fieldset class="ac-fieldset">
      <legend>Development factors</legend>
      <div mtr-segmented label="Factor average" [value]="form().average" [options]="averageOptions" (changed)="set('average', $event)"></div>
      @if (form().average === 'LATEST_DIAGONALS') {
        <div
          mtr-number-field
          fieldId="rs-latest"
          label="Latest calendar years used"
          [value]="form().latestDiagonals"
          [error]="errors()['latestDiagonals']"
          (changed)="set('latestDiagonals', $event)"
        ></div>
      }
      <div class="ac-fieldRow">
        <div
          mtr-number-field
          fieldId="rs-tail-paid"
          label="Paid tail factor"
          hint="1 = no development after the last year"
          [value]="form().tailPaid"
          [error]="errors()['tailPaid']"
          (changed)="set('tailPaid', $event)"
        ></div>
        <div
          mtr-number-field
          fieldId="rs-tail-incurred"
          label="Incurred tail factor"
          [value]="form().tailIncurred"
          [error]="errors()['tailIncurred']"
          (changed)="set('tailIncurred', $event)"
        ></div>
      </div>
    </fieldset>
    <fieldset class="ac-fieldset">
      <legend>Prior estimate</legend>
      <div
        mtr-number-field
        fieldId="rs-loss-ratio"
        label="Expected loss ratio"
        suffix="%"
        hint="Ultimate claims ÷ earned premium, used by the expected loss ratio and Bornhuetter–Ferguson methods. Leave empty to skip them."
        [value]="form().lossRatioPct"
        [error]="errors()['lossRatioPct']"
        (changed)="set('lossRatioPct', $event)"
      ></div>
    </fieldset>
    <ng-content />
  `,
})
export class ReservingAssumptionsComponent {
  readonly form = input.required<ReservingForm>();
  readonly errors = input.required<ReservingFormErrors>();
  readonly changed = output<ReservingChange>();
  protected readonly averageOptions = (Object.keys(AVERAGE_LABEL) as FactorAverage[]).map((value) => ({ value, label: AVERAGE_LABEL[value] }));

  protected set(key: ReservingTextKey, value: string): void {
    this.changed.emit({ key, value });
  }
}

/* ---------- Results ---------- */

@Component({
  selector: 'mtr-reserve-kpis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    @let t = results().reserves.totals;
    @let totals = available();
    @let ibnr = totals?.ibnr ?? null;
    <div class="ac-toolbar" style="margin-bottom: var(--space-3)">
      <div class="field">
        <label class="field-label" for="rs-method">Method for the headline figures</label>
        <select id="rs-method" class="select" (change)="methodChange.emit($any($event.target).value)">
          @for (m of results().methods; track m.method) {
            <option [value]="m.method" [selected]="m.method === method()">{{ label(m.method) }}{{ m.available ? '' : ' (not available)' }}</option>
          }
        </select>
      </div>
    </div>
    <div class="ac-kpis">
      <div mtr-kpi label="Paid to date" icon="actuarial" [hint]="results().origins.length + ' accident years to ' + results().valuationYear">
        <span class="num">{{ tndShort(t.paid) }}</span>
      </div>
      <div mtr-kpi label="Case reserves" [hint]="t.incurred === null ? 'Needs an incurred triangle' : 'Reported ' + tndShort(t.incurred) + ' − paid'">
        <span class="num">{{ t.caseReserve === null ? dash : tndShort(t.caseReserve) }}</span>
      </div>
      <div mtr-kpi label="Ultimate" [hint]="reason() ?? label(method())">
        <span class="num">{{ totals ? tndShort(totals.ultimate) : dash }}</span>
      </div>
      <div mtr-kpi label="Unpaid" hint="Ultimate − paid = case reserves + IBNR">
        <span class="num">{{ totals ? tndShort(totals.unpaid) : dash }}</span>
      </div>
      <div mtr-kpi label="IBNR" hint="Ultimate − reported; includes IBNER" [tone]="ibnr !== null && ibnr < 0 ? 'warning' : 'default'">
        <span class="num">{{ ibnr === null ? dash : tndShort(ibnr) }}</span>
      </div>
    </div>
  `,
})
export class ReserveKpisComponent {
  readonly results = input.required<ReservingResult>();
  readonly method = input.required<ReservingMethod>();
  readonly methods = input.required<MethodLabels>();
  readonly methodChange = output<ReservingMethod>();
  protected readonly dash = DASH;
  protected readonly tndShort = tndShort;
  private readonly estimate = computed(() => this.results().methods.find((m) => m.method === this.method()));
  protected readonly available = computed(() => {
    const e = this.estimate();
    return e?.available ? e.totals : null;
  });
  protected readonly reason = computed(() => {
    const e = this.estimate();
    return e && !e.available ? e.reason : null;
  });
  protected readonly label = (id: ReservingMethod) => methodLabel(this.methods(), id);
}

@Component({
  selector: 'mtr-checks-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    @let warnings = results().warnings;
    @let r = results().reconciliation;
    <section mtr-panel panelId="checks" heading="Data checks" description="What the server found in the triangles and assumptions.">
      <span mtrPanelBadge [class]="warnings.length > 0 ? 'ac-neg' : 'ac-pos'">{{ warnings.length > 0 ? warnings.length + ' to review' : 'No warnings' }}</span>
      @if (warnings.length > 0) {
        <ul class="ac-warnings">
          @for (w of warnings; track w.code) {
            <li>{{ w.message }}</li>
          }
        </ul>
      } @else {
        <p class="field-hint">No missing amounts, decreases, negative case reserves or undefined factors were found.</p>
      }
      <p class="ac-note">
        {{ r.holds ? 'Reconciled' : 'Not reconciled' }}: for every method and accident year, unpaid = ultimate − paid = case reserve + IBNR, and each total equals the sum of its years (largest
        relative difference {{ r.maxDifference.toExponential(1) }}).
      </p>
    </section>
  `,
})
export class ChecksPanelComponent {
  readonly results = input.required<ReservingResult>();
}

interface TriangleCell {
  hidden: boolean;
  text: string;
  kind: 'projected' | 'missing' | 'latest' | null;
  title: string | null;
}

@Component({
  selector: 'mtr-triangle-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, SegmentedComponent],
  host: { style: 'display: contents' },
  template: `
    @let c = cl();
    <section mtr-panel panelId="triangle" [heading]="basisLabel[c.basis] + ' triangle'" [description]="description()">
      <div class="ac-toolbar" style="margin-bottom: var(--space-3)">
        @if (results().chainLadder.incurred) {
          <div mtr-segmented label="Triangle" [value]="c.basis" [options]="basisOptions" (changed)="basis.set($any($event))"></div>
        }
        <div mtr-segmented label="Triangle view" [value]="view()" [options]="viewOptions" (changed)="view.set($any($event))"></div>
      </div>
      <div class="table-wrap ac-triangle">
        <table class="data-table">
          <caption class="sr-only">{{ caption() }}</caption>
          <thead>
            <tr>
              <th scope="col">Accident year</th>
              @for (h of headers(); track $index) {
                <th scope="col" class="num">{{ h }}</th>
              }
              @if (view() === 'COMPLETED') {
                <th scope="col" class="num">Ultimate</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.origin) {
              <tr>
                <th scope="row">{{ row.origin }}</th>
                @for (cell of row.cells; track $index) {
                  @if (cell.hidden) {
                    <td aria-hidden="true"></td>
                  } @else {
                    <td class="num" [attr.data-kind]="cell.kind" [attr.title]="cell.title">{{ cell.text }}</td>
                  }
                }
                @if (view() === 'COMPLETED') {
                  <td class="num">{{ row.ultimate }}</td>
                }
              </tr>
            }
          </tbody>
          @if (view() === 'LINK_RATIOS') {
            <tfoot>
              <tr data-total="true">
                <th scope="row">Selected</th>
                @for (f of c.factors; track f.from) {
                  <td class="num">{{ factor(f.selected) }}</td>
                }
              </tr>
            </tfoot>
          }
        </table>
      </div>
      <p class="ac-note">{{ note() }}</p>
    </section>
  `,
})
export class TrianglePanelComponent {
  readonly results = input.required<ReservingResult>();
  protected readonly basis = signal<ReservingBasis>('PAID');
  protected readonly view = signal<TriangleView>('CUMULATIVE');
  protected readonly basisLabel = BASIS_LABEL;
  protected readonly basisOptions = BASIS_OPTIONS;
  protected readonly viewOptions = (Object.keys(VIEW_LABEL) as TriangleView[]).map((value) => ({ value, label: VIEW_LABEL[value] }));
  protected readonly factor = factor;
  protected readonly cl = computed(() => pickBasis(this.results(), this.basis()));

  protected readonly description = computed(() => {
    const view = this.view();
    if (view === 'COMPLETED') return 'Observed amounts with the future projected by the selected factors (shaded), to the ultimate.';
    return view === 'LINK_RATIOS'
      ? 'Individual age-to-age factors C(j+1) ÷ C(j); blank where either amount is missing or the base is zero.'
      : 'Amounts by accident year (rows) and development year (columns), in dinars.';
  });

  protected readonly caption = computed(() => {
    const r = this.results();
    return `${BASIS_LABEL[this.cl().basis]} triangle, ${VIEW_LABEL[this.view()].toLowerCase()}, accident years ${r.origins[0]} to ${r.valuationYear}`;
  });

  private readonly columns = computed(() => {
    const n = this.results().origins.length;
    return this.view() === 'LINK_RATIOS' ? n - 1 : n;
  });

  protected readonly headers = computed(() => {
    const ratios = this.view() === 'LINK_RATIOS';
    return Array.from({ length: this.columns() }, (_, j) => (ratios ? `${j + 1}–${j + 2}` : String(j + 1)));
  });

  protected readonly rows = computed(() => {
    const results = this.results();
    const cl = this.cl();
    const view = this.view();
    const n = results.origins.length;
    const ratios = view === 'LINK_RATIOS';
    const values: Cell[][] = view === 'INCREMENTAL' ? cl.incremental : ratios ? cl.linkRatios : cl.projected;
    const show = (v: Cell) => (ratios ? factor(v) : amount(v));
    return results.origins.map((origin, i) => {
      const observed = n - i - (ratios ? 1 : 0);
      const cells = Array.from({ length: this.columns() }, (_, j): TriangleCell => {
        if (j >= observed && view !== 'COMPLETED') return { hidden: true, text: '', kind: null, title: null };
        const v = values[i][j];
        const kind = j >= observed ? 'projected' : v === null ? 'missing' : j === observed - 1 ? 'latest' : null;
        return { hidden: false, text: show(v), kind, title: kind === 'missing' ? 'Missing amount' : kind === 'projected' ? 'Projected' : null };
      });
      return { origin, cells, ultimate: amount(cl.origins[i].ultimate) };
    });
  });

  protected readonly note = computed(
    () =>
      `Bold: latest diagonal (the valuation date). ${this.view() === 'COMPLETED' ? `Shaded: projected. Ultimate includes the tail factor ${factor(this.cl().tail)}. ` : ''}A dash marks a missing amount.`,
  );
}

@Component({
  selector: 'mtr-factors-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, SegmentedComponent],
  host: { style: 'display: contents' },
  template: `
    @let c = cl();
    @let n = results().origins.length;
    <section mtr-panel panelId="factors" heading="Development factors" [description]="description()">
      @if (hasSelections()) {
        <button mtrPanelActions type="button" class="btn btn-ghost btn-sm" (click)="clear.emit(c.basis)">Clear selections</button>
      }
      <div class="ac-toolbar" style="margin-bottom: var(--space-3)">
        @if (results().chainLadder.incurred) {
          <div mtr-segmented label="Triangle" [value]="c.basis" [options]="basisOptions" (changed)="basis.set($any($event))"></div>
        }
      </div>
      <div class="table-wrap ac-rows ac-compact">
        <table class="data-table">
          <caption class="sr-only">{{ basisLabel[c.basis] }} development factors by development period, with cumulative factors to ultimate</caption>
          <thead>
            <tr>
              <th scope="col">Years</th>
              <th scope="col" class="num">Pairs</th>
              <th scope="col" class="num">Weighted</th>
              <th scope="col" class="num">Simple</th>
              @if (latest()) {
                <th scope="col" class="num">Latest {{ results().averaging.latestDiagonals }}</th>
              }
              <th scope="col" class="num">Selected</th>
              <th scope="col" class="num">CDF</th>
              <th scope="col" class="num">Developed</th>
            </tr>
          </thead>
          <tbody>
            @for (f of c.factors; track f.from; let j = $index) {
              @let id = 'rs-factor-' + c.basis.toLowerCase() + '-' + j;
              @let error = errors()[key() + '-' + j];
              <tr>
                <th scope="row">{{ f.from }} to {{ f.to }}</th>
                <td class="num">{{ f.pairs }}</td>
                <td class="num">{{ factor(f.volumeWeighted) }}</td>
                <td class="num">
                  {{ factor(f.simpleAverage) }}
                  @if (f.min !== null && f.max !== null && f.pairs > 1) {
                    <span class="ac-hint">{{ factor(f.min) }} to {{ factor(f.max) }}</span>
                  }
                </td>
                @if (latest()) {
                  <td class="num">{{ factor(f.latestDiagonals) }}</td>
                }
                <td class="num">
                  <label class="sr-only" [attr.for]="id">Selected {{ basisLabel[c.basis].toLowerCase() }} factor, development years {{ f.from }} to {{ f.to }}</label>
                  <input
                    [id]="id"
                    class="input num ac-factorInput"
                    inputmode="decimal"
                    autocomplete="off"
                    [placeholder]="f.estimated === null ? 'Required' : factor(f.estimated)"
                    [value]="selections()[j] ?? ''"
                    [attr.aria-invalid]="error ? true : null"
                    [attr.aria-describedby]="error ? id + '-error' : null"
                    (input)="selectFactor.emit({ basis: c.basis, index: j, value: $any($event.target).value })"
                  />
                  @if (error) {
                    <span [id]="id + '-error'" class="field-error" style="display: block">{{ error }}</span>
                  } @else if (f.source === 'SELECTED') {
                    <span class="ac-hint">Using {{ factor(f.selected) }}</span>
                  }
                </td>
                <td class="num">{{ factor(c.cdf[j]) }}</td>
                <td class="num">{{ ratio(c.percentDeveloped[j], 1) }}</td>
              </tr>
            }
            <tr data-total="true">
              <th scope="row">Tail after {{ n }}</th>
              <td [attr.colspan]="latest() ? 4 : 3"></td>
              <td class="num">{{ factor(c.tail) }}</td>
              <td class="num">{{ factor(c.cdf[n - 1]) }}</td>
              <td class="num">{{ ratio(c.percentDeveloped[n - 1], 1) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="ac-note">
        Weighted: Σ C(j+1) ÷ Σ C(j); simple: mean of the link ratios, with their range below. CDF is the cumulative factor to ultimate from that development year: the product of the selected factors
        that follow and the tail. Missing amounts are left out of every average.
      </p>
    </section>
  `,
})
export class FactorsPanelComponent {
  readonly results = input.required<ReservingResult>();
  readonly form = input.required<ReservingForm>();
  readonly errors = input.required<ReservingFormErrors>();
  readonly selectFactor = output<FactorSelection>();
  readonly clear = output<ReservingBasis>();
  protected readonly basis = signal<ReservingBasis>('PAID');
  protected readonly basisLabel = BASIS_LABEL;
  protected readonly basisOptions = BASIS_OPTIONS;
  protected readonly factor = factor;
  protected readonly ratio = ratio;
  protected readonly cl = computed(() => pickBasis(this.results(), this.basis()));
  protected readonly key = computed(() => (this.cl().basis === 'PAID' ? 'selectedPaid' : 'selectedIncurred'));
  protected readonly selections = computed(() => this.form()[this.key()]);
  protected readonly hasSelections = computed(() => this.selections().some((s) => s.trim() !== ''));
  protected readonly latest = computed(() => this.results().averaging.method === 'LATEST_DIAGONALS');
  protected readonly description = computed(
    () =>
      `Estimated age-to-age factors and your selection. The ${AVERAGE_LABEL[this.results().averaging.method].toLowerCase()} estimate is used unless you enter a factor.`,
  );
}

@Component({
  selector: 'mtr-reserves-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    @let r = results().reserves;
    <section mtr-panel panelId="reserves" heading="Reserves by accident year" description="Each amount counted once: unpaid = case reserves + IBNR. Amounts in dinars.">
      @if (estimate(); as e) {
        <div class="table-wrap ac-rows ac-compact">
          <table class="data-table">
            <caption class="sr-only">Paid, case reserves, ultimate, unpaid and IBNR by accident year</caption>
            <thead>
              <tr>
                <th scope="col">Accident year</th>
                <th scope="col" class="num">Premium</th>
                <th scope="col" class="num">Paid</th>
                <th scope="col" class="num">Case reserve</th>
                <th scope="col" class="num">Ultimate</th>
                <th scope="col" class="num">Unpaid</th>
                <th scope="col" class="num">IBNR</th>
              </tr>
            </thead>
            <tbody>
              @for (o of r.origins; track o.origin; let i = $index) {
                @let y = e.origins[i];
                <tr>
                  <th scope="row">{{ o.origin }}</th>
                  <td class="num">{{ amount(o.premium) }}</td>
                  <td class="num">{{ amount(o.paid) }}</td>
                  <td class="num">{{ amount(o.caseReserve) }}</td>
                  <td class="num">{{ amount(y.ultimate) }}</td>
                  <td class="num" [class.ac-neg]="y.unpaid < 0">{{ amount(y.unpaid) }}</td>
                  <td class="num" [class.ac-neg]="y.ibnr !== null && y.ibnr < 0">{{ amount(y.ibnr) }}</td>
                </tr>
              }
              <tr data-total="true">
                <th scope="row">Total</th>
                <td class="num">{{ amount(r.totals.premium) }}</td>
                <td class="num">{{ amount(r.totals.paid) }}</td>
                <td class="num">{{ amount(r.totals.caseReserve) }}</td>
                <td class="num">{{ amount(e.totals.ultimate) }}</td>
                <td class="num">{{ amount(e.totals.unpaid) }}</td>
                <td class="num">{{ amount(e.totals.ibnr) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      } @else {
        <div mtr-empty-state icon="info" heading="Method not available" [description]="reason()"></div>
      }
    </section>
  `,
})
export class ReservesPanelComponent {
  readonly results = input.required<ReservingResult>();
  readonly method = input.required<ReservingMethod>();
  protected readonly amount = amount;
  private readonly found = computed(() => this.results().methods.find((m) => m.method === this.method()) as MethodEstimate);
  protected readonly estimate = computed(() => {
    const e = this.found();
    return e.available ? e : null;
  });
  protected readonly reason = computed(() => {
    const e = this.found();
    return e.available ? '' : e.reason;
  });
}

@Component({
  selector: 'mtr-methods-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section
      mtr-panel
      panelId="methods"
      heading="Method comparison"
      description="Totals over all accident years. The spread between methods is a first view of estimation uncertainty."
    >
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Total ultimate, unpaid and IBNR by reserving method</caption>
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col" class="num">Ultimate</th>
              <th scope="col" class="num">Unpaid</th>
              <th scope="col" class="num">IBNR</th>
            </tr>
          </thead>
          <tbody>
            @for (m of rows(); track m.method) {
              <tr [attr.aria-current]="m.method === method() ? 'true' : null">
                <th scope="row">
                  {{ m.label }}
                  @if (m.reason !== null) {
                    <span class="ac-hint">{{ m.reason }}</span>
                  }
                </th>
                <td class="num">{{ m.ultimate }}</td>
                <td class="num">{{ m.unpaid }}</td>
                <td class="num">{{ m.ibnr }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class MethodsPanelComponent {
  readonly results = input.required<ReservingResult>();
  readonly method = input.required<ReservingMethod>();
  readonly labels = input.required<MethodLabels>();
  protected readonly rows = computed(() =>
    this.results().methods.map((m) => ({
      method: m.method,
      label: methodLabel(this.labels(), m.method),
      reason: m.available ? null : m.reason,
      ultimate: m.available ? tndWhole(m.totals.ultimate) : DASH,
      unpaid: m.available ? tndWhole(m.totals.unpaid) : DASH,
      ibnr: m.available ? tndWhole(m.totals.ibnr) : DASH,
    })),
  );
}

@Component({
  selector: 'mtr-paid-incurred-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section
      mtr-panel
      panelId="paid-incurred"
      heading="Paid against incurred"
      description="Chain ladder ultimates on both bases. A persistent gap points to a change in payment speed or case reserving."
    >
      @if (results().paidVsIncurred; as p) {
        <div class="table-wrap ac-rows ac-compact">
          <table class="data-table">
            <caption class="sr-only">Paid and incurred chain ladder ultimates by accident year</caption>
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" class="num">Paid CL</th>
                <th scope="col" class="num">Incurred CL</th>
                <th scope="col" class="num">Gap</th>
              </tr>
            </thead>
            <tbody>
              @for (o of p.origins; track o.origin) {
                <tr>
                  <th scope="row">{{ o.origin }}</th>
                  <td class="num">{{ amount(o.paidUltimate) }}</td>
                  <td class="num">{{ amount(o.incurredUltimate) }}</td>
                  <td class="num">{{ ratio(o.relativeDifference, 1) }}</td>
                </tr>
              }
              <tr data-total="true">
                <th scope="row">Total</th>
                <td class="num">{{ amount(p.totals.paidUltimate) }}</td>
                <td class="num">{{ amount(p.totals.incurredUltimate) }}</td>
                <td class="num">{{ ratio(p.totals.relativeDifference, 1) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      } @else {
        <div mtr-empty-state icon="info" heading="No incurred triangle" description="Add the incurred triangle to compare the two chain ladders."></div>
      }
    </section>
  `,
})
export class PaidIncurredPanelComponent {
  readonly results = input.required<ReservingResult>();
  protected readonly amount = amount;
  protected readonly ratio = ratio;
}

@Component({
  selector: 'mtr-curves-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, LineChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let c = chart();
    <section mtr-panel panelId="curves" heading="Development pattern" description="Expected share of the ultimate reached by each development year, from the selected factors.">
      <figure mtr-line-chart [series]="c.series" [formatY]="ratio0" [yMin]="0" [height]="180" [xLabels]="c.xLabels" [summary]="c.summary"></figure>
    </section>
  `,
})
export class CurvesPanelComponent {
  readonly results = input.required<ReservingResult>();
  protected readonly ratio0 = (v: number) => ratio(v, 0);
  protected readonly chart = computed(() => {
    const results = this.results();
    const n = results.origins.length;
    const series: ChartSeries[] = [{ label: 'Paid, share of ultimate', values: results.chainLadder.paid.percentDeveloped, tone: 'brand' }];
    if (results.chainLadder.incurred) series.push({ label: 'Incurred, share of ultimate', values: results.chainLadder.incurred.percentDeveloped, tone: 'cyan', dashed: true });
    const last = results.chainLadder.paid.percentDeveloped;
    return {
      series,
      xLabels: ['Year 1', `Year ${n}`] as [string, string],
      summary: `Paid development from ${ratio(last[0], 0)} of the ultimate in year 1 to ${ratio(last[n - 1], 0)} in year ${n}${results.chainLadder.incurred ? ', with the incurred pattern for comparison' : ''}.`,
    };
  });
}

@Component({
  selector: 'mtr-reserving-sensitivity-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    @let incurred = results().chainLadder.incurred !== null;
    <section mtr-panel panelId="sensitivity" heading="Sensitivity" [description]="description()">
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Total unpaid under alternative assumptions and change from the base</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col" class="num">Unpaid</th>
              <th scope="col" class="num">Change</th>
            </tr>
          </thead>
          <tbody>
            @for (line of results().sensitivity.scenarios; track line.id) {
              <tr [attr.aria-current]="line.id === 'base' ? 'true' : null">
                <th scope="row">
                  {{ line.label }}
                  @if (line.note) {
                    <span class="ac-hint">{{ line.note }}</span>
                  }
                </th>
                <td class="num">{{ amount(line.unpaid[method()]) }}</td>
                <td class="num">{{ line.id === 'base' ? dash : signed(line.change[method()]) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <h3 class="ac-subhead">One factor at a time</h3>
      <div class="table-wrap ac-rows ac-compact">
        <table class="data-table">
          <caption class="sr-only">Change in chain ladder total unpaid when one selected factor rises by one percent</caption>
          <thead>
            <tr>
              <th scope="col">Factor raised by 1%</th>
              <th scope="col" class="num">Paid CL change</th>
              @if (incurred) {
                <th scope="col" class="num">Incurred CL change</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (f of paidFactors(); track f.from; let j = $index) {
              <tr>
                <th scope="row">{{ f.from }} to {{ f.to }}</th>
                <td class="num">{{ signed(f.change) }}</td>
                @if (incurred) {
                  <td class="num">{{ signed(incurredFactors()[j]?.change) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="ac-note">Early factors apply to the youngest accident years, where most of the reserve sits, so their selection usually matters most.</p>
    </section>
  `,
})
export class ReservingSensitivityPanelComponent {
  readonly results = input.required<ReservingResult>();
  readonly method = input.required<ReservingMethod>();
  readonly labels = input.required<MethodLabels>();
  protected readonly dash = DASH;
  protected readonly amount = amount;
  protected readonly signed = signed;
  protected readonly paidFactors = computed(() => this.results().sensitivity.factors.filter((f) => f.basis === 'PAID'));
  protected readonly incurredFactors = computed(() => this.results().sensitivity.factors.filter((f) => f.basis === 'INCURRED'));
  protected readonly description = computed(
    () => `Total unpaid for ${methodLabel(this.labels(), this.method()).toLowerCase()} when one assumption changes, everything else held.`,
  );
}

@Component({
  selector: 'mtr-cash-flow-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, ColumnChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let c = results().cashFlows;
    <section
      mtr-panel
      panelId="cash-flows"
      heading="Expected payments by calendar year"
      description="Paid chain ladder unpaid amount spread over future years. Undiscounted, before any inflation adjustment: the liability input for asset–liability matching."
    >
      @if (c.periods.length > 0) {
        <figure
          mtr-column-chart
          [from]="first()"
          [binWidth]="1"
          [values]="payments()"
          [height]="160"
          [formatX]="formatX"
          [formatY]="tndShort"
          seriesLabel="Expected payments"
          [summary]="summary()"
        ></figure>
      }
      <div class="table-wrap ac-rows" style="margin-top: var(--space-3)">
        <table class="data-table">
          <caption class="sr-only">Expected claim payments by future calendar year</caption>
          <thead>
            <tr>
              <th scope="col">Calendar year</th>
              <th scope="col" class="num">Expected payment</th>
            </tr>
          </thead>
          <tbody>
            @for (p of c.periods; track p.calendarYear) {
              <tr>
                <th scope="row">{{ p.calendarYear }}</th>
                <td class="num">{{ tndWhole(p.expectedPayment) }}</td>
              </tr>
            }
            @if (c.afterLastDevelopmentYear !== 0) {
              <tr>
                <th scope="row">
                  After development year {{ results().origins.length }}
                  <span class="ac-hint">Tail factor; timing not modelled</span>
                </th>
                <td class="num">{{ tndWhole(c.afterLastDevelopmentYear) }}</td>
              </tr>
            }
            <tr data-total="true">
              <th scope="row">Total (equals paid chain ladder unpaid)</th>
              <td class="num">{{ tndWhole(c.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class CashFlowPanelComponent {
  readonly results = input.required<ReservingResult>();
  protected readonly tndShort = tndShort;
  protected readonly tndWhole = tndWhole;
  protected readonly first = computed(() => {
    const c = this.results().cashFlows;
    return c.periods[0]?.calendarYear ?? c.valuationYear + 1;
  });
  protected readonly payments = computed(() => this.results().cashFlows.periods.map((p) => p.expectedPayment));
  protected readonly formatX = (v: number) => (v === this.first() ? `1 Jan ${v}` : `31 Dec ${v - 1}`);
  protected readonly summary = computed(() => {
    const c = this.results().cashFlows;
    const first = this.first();
    return `Expected payments from ${first} to ${first + c.periods.length - 1}, totalling ${tndWhole(c.total)} with the tail.`;
  });
}

/* ---------- Saved runs ---------- */

@Component({
  selector: 'mtr-reserving-runs-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, IconComponent],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="runs" heading="Your reserving runs" [description]="description()">
      <form class="ac-saveForm" novalidate (submit)="submit($event)">
        <div class="field">
          <label class="field-label" for="rs-run-label">Run label</label>
          <input
            id="rs-run-label"
            class="input"
            maxlength="80"
            autocomplete="off"
            [value]="label()"
            [attr.aria-invalid]="labelError() ? true : null"
            [attr.aria-describedby]="labelError() ? 'rs-run-label-error' : null"
            (input)="label.set($any($event.target).value)"
          />
          @if (labelError()) {
            <p id="rs-run-label-error" class="field-error">{{ labelError() }}</p>
          }
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="!canSave() || saving() || trimmed() === '' || labelError() !== null">
          <svg mtrIcon name="check" [size]="14" /> {{ saving() ? 'Enregistrement…' : 'Enregistrer le calcul' }}
        </button>
      </form>
      @if (message(); as m) {
        <p [class]="m.tone === 'error' ? 'field-error' : 'field-hint'" [attr.role]="m.tone === 'error' ? 'alert' : 'status'">{{ m.text }}</p>
      }
      @if (history(); as h) {
        @if (h.runs.length === 0) {
          <div mtr-empty-state icon="info" heading="Aucun calcul enregistré" description="Nommez l'analyse actuelle et enregistrez-la pour comparer les valorisations plus tard."></div>
        } @else {
          <div class="table-wrap ac-rows">
            <table class="data-table">
              <caption class="sr-only">Vos calculs de provisionnement enregistrés, du plus récent au plus ancien</caption>
              <thead>
                <tr>
                  <th scope="col">Calcul</th>
                  <th scope="col" class="num">Payé à ce jour</th>
                  <th scope="col" class="num">Non payé, CL payé</th>
                  <th scope="col" class="num">Avertissements</th>
                  <th scope="col"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                @for (s of h.runs; track s.id) {
                  @let paidCl = paidUnpaid(s);
                  <tr [attr.aria-current]="s.id === activeId() ? 'true' : null">
                    <th scope="row">
                      {{ s.label }}
                      <span class="ac-hint">Années de survenance {{ s.firstOrigin }}–{{ s.valuationYear }}, {{ createdAt(s.createdAt) }}</span>
                      @if (s.stale) {
                        <span class="ac-hint">Version antérieure du modèle</span>
                      }
                    </th>
                    <td class="num">{{ tndShort(s.headline.paid) }}</td>
                    <td class="num">{{ paidCl === null ? dash : tndShort(paidCl) }}</td>
                    <td class="num">{{ s.headline.warnings }}</td>
                    <td>
                      <div class="ac-rowActions">
                        <button type="button" class="btn btn-ghost btn-sm" (click)="loadRun.emit(s)">Charger<span class="sr-only"> {{ s.label }}</span></button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="deleteRun.emit(s)">Supprimer<span class="sr-only"> {{ s.label }}</span></button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else {
        <div mtr-panel-skeleton [rows]="2"></div>
      }
    </section>
  `,
})
export class ReservingRunsPanelComponent {
  readonly history = input.required<{ kept: number; runs: ReservingRunSummary[] } | null>();
  readonly message = input.required<ActuarialMessage | null>();
  readonly activeId = input.required<string | null>();
  readonly canSave = input.required<boolean>();
  /** Saves the shown analysis under a label; resolves to whether it was saved. */
  readonly save = input.required<(label: string) => Promise<boolean>>();
  readonly loadRun = output<ReservingRunSummary>();
  readonly deleteRun = output<ReservingRunSummary>();

  protected readonly label = signal('');
  protected readonly saving = signal(false);
  protected readonly trimmed = computed(() => this.label().trim());
  protected readonly labelError = computed(() =>
    this.trimmed() !== '' && !RUN_LABEL.test(this.trimmed()) ? "Use letters, digits, spaces and . , ' & ( ) % + / - (at most 80 characters)." : null,
  );
  protected readonly dash = DASH;
  protected readonly tndShort = tndShort;
  protected readonly createdAt = (iso: string) => new Date(iso).toLocaleString('en-GB');
  protected readonly paidUnpaid = (s: ReservingRunSummary) => s.headline.methods.find((m) => m.method === 'CHAIN_LADDER_PAID')?.unpaid ?? null;
  protected readonly description = computed(() => {
    const kept = this.history()?.kept;
    return `Enregistrez les entrées et résultats affichés ci-dessus. ${kept ? `Les ${kept} plus récents sont conservés. ` : ''}Les calculs sont privés à votre compte.`;
  });

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const trimmed = this.trimmed();
    if (!this.canSave() || trimmed === '' || this.labelError()) return;
    this.saving.set(true);
    if (await this.save()(trimmed)) this.label.set('');
    this.saving.set(false);
  }
}

const RESERVING_METHOD = [
  'Paid P        claim payments to date (cumulative)',
  'Reported I    incurred = paid + case reserves set claim by claim',
  'Ultimate U    estimated total cost of the accident year',
  'Unpaid        U − P = case reserves + IBNR      (each amount counted once)',
  'IBNR          U − I: claims not yet reported plus further development of known claims (IBNER)',
  '',
  'Link ratio    f(i, j) = C(i, j+1) / C(i, j); missing amounts are left out',
  'Volume-wtd    f(j) = Σ C(i, j+1) / Σ C(i, j) over years with both amounts',
  'To ultimate   CDF(j) = f(j) · f(j+1) · … · f(n−1) · tail',
  'Chain ladder  U = latest amount × CDF at its age',
  'Exp. loss     U = premium × expected loss ratio',
  'B–F           U = latest + premium × ELR × (1 − 1 / CDF)',
].join('\n');

@Component({
  selector: 'mtr-reserving-method-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="method" heading="Definitions and methods">
      <details class="ac-explain">
        <summary>Show the definitions and formulas</summary>
        <pre class="ac-formula">{{ method }}</pre>
        <p class="ac-note">
          Annual triangles only. Best estimates are undiscounted, without inflation adjustment or a risk margin, and carry no measure of variability (Mack or bootstrap are not implemented yet).
          IBNER is included in IBNR because separating it needs claim-level data.
        </p>
      </details>
    </section>
  `,
})
export class ReservingMethodNotesComponent {
  protected readonly method = RESERVING_METHOD;
}
