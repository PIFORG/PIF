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
const BASIS_LABEL: Record<ReservingBasis, string> = { PAID: 'Payés', INCURRED: 'Survenus' };
const AVERAGE_LABEL: Record<FactorAverage, string> = { VOLUME_WEIGHTED: 'Pondérée par volume', SIMPLE_AVERAGE: 'Moyenne simple', LATEST_DIAGONALS: 'Dernières années' };
type TriangleView = 'CUMULATIVE' | 'INCREMENTAL' | 'LINK_RATIOS' | 'COMPLETED';
const VIEW_LABEL: Record<TriangleView, string> = { CUMULATIVE: 'Cumulés', INCREMENTAL: 'Incrémentaux', LINK_RATIOS: 'Coefficients de passage', COMPLETED: 'Complétés' };
const BASIS_OPTIONS = [
  { value: 'PAID', label: 'Payés' },
  { value: 'INCURRED', label: 'Survenus' },
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
      <label class="field-label" for="rs-example">Triangle d'exemple (fictif)</label>
      <select id="rs-example" class="select" (change)="example.emit($any($event.target).value)">
        <option value="" [selected]="exampleId() === ''">Vos propres données</option>
        @for (e of catalogue().examples; track e.id) {
          <option [value]="e.id" [selected]="e.id === exampleId()">{{ e.name }}</option>
        }
      </select>
      <p class="field-hint">{{ exampleText() ?? 'Modifié par vous. Choisissez un exemple pour recommencer.' }}</p>
    </div>
    <div
      mtr-number-field
      fieldId="rs-first-origin"
      label="Première année de survenance"
      [hint]="'De ' + catalogue().limits.minOrigins + ' à ' + catalogue().limits.maxOrigins + ' années de survenance ; la dernière est l\u2019année de valorisation.'"
      [value]="form().firstOrigin"
      [error]="errors()['firstOrigin']"
      (changed)="set('firstOrigin', $event)"
    ></div>
    <div
      mtr-triangle-field
      fieldId="rs-paid"
      label="Sinistres payés cumulés (DT)"
      hint="Une ligne par année de survenance, la plus ancienne en premier ; montants par année de développement séparés par espaces, tabulations ou points-virgules. Montant manquant : - (exclu, jamais lu comme zéro)."
      [rows]="lines()"
      [value]="form().paid"
      [error]="errors()['paid']"
      (changed)="set('paid', $event)"
    ></div>
    <div
      mtr-triangle-field
      fieldId="rs-incurred"
      label="Survenus cumulés (DT, facultatif)"
      hint="Montants déclarés : payé + provisions dossier ; même disposition que les payés."
      [rows]="lines()"
      [value]="form().incurred"
      [error]="errors()['incurred']"
      (changed)="set('incurred', $event)"
    ></div>
    <div
      mtr-triangle-field
      fieldId="rs-premiums"
      label="Primes acquises par année de survenance (DT, facultatif)"
      hint="Un montant par année de survenance, pour le ratio sinistres/primes attendu et les méthodes Bornhuetter–Ferguson."
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
      <legend>Facteurs de développement</legend>
      <div mtr-segmented label="Moyenne des facteurs" [value]="form().average" [options]="averageOptions" (changed)="set('average', $event)"></div>
      @if (form().average === 'LATEST_DIAGONALS') {
        <div
          mtr-number-field
          fieldId="rs-latest"
          label="Dernières années calendaires utilisées"
          [value]="form().latestDiagonals"
          [error]="errors()['latestDiagonals']"
          (changed)="set('latestDiagonals', $event)"
        ></div>
      }
      <div class="ac-fieldRow">
        <div
          mtr-number-field
          fieldId="rs-tail-paid"
          label="Facteur de queue des paiements"
          hint="1 = pas de développement après la dernière année"
          [value]="form().tailPaid"
          [error]="errors()['tailPaid']"
          (changed)="set('tailPaid', $event)"
        ></div>
        <div
          mtr-number-field
          fieldId="rs-tail-incurred"
          label="Facteur de queue des survenus"
          [value]="form().tailIncurred"
          [error]="errors()['tailIncurred']"
          (changed)="set('tailIncurred', $event)"
        ></div>
      </div>
    </fieldset>
    <fieldset class="ac-fieldset">
      <legend>Estimation a priori</legend>
      <div
        mtr-number-field
        fieldId="rs-loss-ratio"
        label="Ratio sinistres/primes attendu"
        suffix="%"
        hint="Sinistres ultimes ÷ primes acquises ; utilisé par le ratio sinistres/primes attendu et Bornhuetter–Ferguson. Laissez vide pour les ignorer."
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
        <label class="field-label" for="rs-method">Méthode pour les chiffres clés</label>
        <select id="rs-method" class="select" (change)="methodChange.emit($any($event.target).value)">
          @for (m of results().methods; track m.method) {
            <option [value]="m.method" [selected]="m.method === method()">{{ label(m.method) }}{{ m.available ? '' : ' (indisponible)' }}</option>
          }
        </select>
      </div>
    </div>
    <div class="ac-kpis">
      <div mtr-kpi label="Payé à ce jour" icon="actuarial" [hint]="results().origins.length + ' années de survenance à ' + results().valuationYear">
        <span class="num">{{ tndShort(t.paid) }}</span>
      </div>
      <div mtr-kpi label="Provisions dossier" [hint]="t.incurred === null ? 'Nécessite un triangle des survenus' : 'Déclaré ' + tndShort(t.incurred) + ' − payé'">
        <span class="num">{{ t.caseReserve === null ? dash : tndShort(t.caseReserve) }}</span>
      </div>
      <div mtr-kpi label="Ultime" [hint]="reason() ?? label(method())">
        <span class="num">{{ totals ? tndShort(totals.ultimate) : dash }}</span>
      </div>
      <div mtr-kpi label="Non payé" hint="Ultime − payé = provisions dossier + IBNR">
        <span class="num">{{ totals ? tndShort(totals.unpaid) : dash }}</span>
      </div>
      <div mtr-kpi label="IBNR" hint="Ultime − déclaré ; inclut l'IBNER" [tone]="ibnr !== null && ibnr < 0 ? 'warning' : 'default'">
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
    <section mtr-panel panelId="checks" heading="Contrôles des données" description="Ce que le serveur a trouvé dans les triangles et les hypothèses.">
      <span mtrPanelBadge [class]="warnings.length > 0 ? 'ac-neg' : 'ac-pos'">{{ warnings.length > 0 ? warnings.length + ' à vérifier' : 'Aucun avertissement' }}</span>
      @if (warnings.length > 0) {
        <ul class="ac-warnings">
          @for (w of warnings; track w.code) {
            <li>{{ w.message }}</li>
          }
        </ul>
      } @else {
        <p class="field-hint">Aucun montant manquant, aucune baisse, aucune provision dossier négative ni facteur indéfini.</p>
      }
      <p class="ac-note">
        {{ r.holds ? 'Rapproché' : 'Non rapproché' }} : pour chaque méthode et année de survenance, non payé = ultime − payé = provision dossier + IBNR, et chaque total égale la somme de ses années (plus grande différence relative {{ r.maxDifference.toExponential(1) }}).
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
    <section mtr-panel panelId="triangle" [heading]="'Triangle des ' + basisLabel[c.basis].toLowerCase()" [description]="description()">
      <div class="ac-toolbar" style="margin-bottom: var(--space-3)">
        @if (results().chainLadder.incurred) {
          <div mtr-segmented label="Triangle" [value]="c.basis" [options]="basisOptions" (changed)="basis.set($any($event))"></div>
        }
        <div mtr-segmented label="Vue du triangle" [value]="view()" [options]="viewOptions" (changed)="view.set($any($event))"></div>
      </div>
      <div class="table-wrap ac-triangle">
        <table class="data-table">
          <caption class="sr-only">{{ caption() }}</caption>
          <thead>
            <tr>
              <th scope="col">Année de survenance</th>
              @for (h of headers(); track $index) {
                <th scope="col" class="num">{{ h }}</th>
              }
              @if (view() === 'COMPLETED') {
                <th scope="col" class="num">Ultime</th>
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
                <th scope="row">Retenu</th>
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
    if (view === 'COMPLETED') return 'Montants observés avec le futur projeté par les facteurs retenus (ombré), jusqu\'à l\'ultime.';
    return view === 'LINK_RATIOS'
      ? 'Coefficients individuels d\'âge à âge C(j+1) ÷ C(j) ; vide si l\'un des montants manque ou si la base est nulle.'
      : 'Montants par année de survenance (lignes) et année de développement (colonnes), en dinars.';
  });

  protected readonly caption = computed(() => {
    const r = this.results();
    return `Triangle des ${BASIS_LABEL[this.cl().basis].toLowerCase()}, ${VIEW_LABEL[this.view()].toLowerCase()}, années de survenance ${r.origins[0]} à ${r.valuationYear}`;
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
        return { hidden: false, text: show(v), kind, title: kind === 'missing' ? 'Montant manquant' : kind === 'projected' ? 'Projeté' : null };
      });
      return { origin, cells, ultimate: amount(cl.origins[i].ultimate) };
    });
  });

  protected readonly note = computed(
    () =>
      `Gras : dernière diagonale (date de valorisation). ${this.view() === 'COMPLETED' ? `Ombré : projeté. L'ultime inclut le facteur de queue ${factor(this.cl().tail)}. ` : ''}Un tiret indique un montant manquant.`,
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
    <section mtr-panel panelId="factors" heading="Facteurs de développement" [description]="description()">
      @if (hasSelections()) {
        <button mtrPanelActions type="button" class="btn btn-ghost btn-sm" (click)="clear.emit(c.basis)">Effacer les sélections</button>
      }
      <div class="ac-toolbar" style="margin-bottom: var(--space-3)">
        @if (results().chainLadder.incurred) {
          <div mtr-segmented label="Triangle" [value]="c.basis" [options]="basisOptions" (changed)="basis.set($any($event))"></div>
        }
      </div>
      <div class="table-wrap ac-rows ac-compact">
        <table class="data-table">
          <caption class="sr-only">Facteurs de développement {{ basisLabel[c.basis].toLowerCase() }} par période de développement, avec facteurs cumulés à l'ultime</caption>
          <thead>
            <tr>
              <th scope="col">Années</th>
              <th scope="col" class="num">Paires</th>
              <th scope="col" class="num">Pondéré</th>
              <th scope="col" class="num">Simple</th>
              @if (latest()) {
                <th scope="col" class="num">Dernières {{ results().averaging.latestDiagonals }}</th>
              }
              <th scope="col" class="num">Retenu</th>
              <th scope="col" class="num">CDF</th>
              <th scope="col" class="num">Développé</th>
            </tr>
          </thead>
          <tbody>
            @for (f of c.factors; track f.from; let j = $index) {
              @let id = 'rs-factor-' + c.basis.toLowerCase() + '-' + j;
              @let error = errors()[key() + '-' + j];
              <tr>
                <th scope="row">{{ f.from }} à {{ f.to }}</th>
                <td class="num">{{ f.pairs }}</td>
                <td class="num">{{ factor(f.volumeWeighted) }}</td>
                <td class="num">
                  {{ factor(f.simpleAverage) }}
                  @if (f.min !== null && f.max !== null && f.pairs > 1) {
                    <span class="ac-hint">{{ factor(f.min) }} à {{ factor(f.max) }}</span>
                  }
                </td>
                @if (latest()) {
                  <td class="num">{{ factor(f.latestDiagonals) }}</td>
                }
                <td class="num">
                  <label class="sr-only" [attr.for]="id">Facteur {{ basisLabel[c.basis].toLowerCase() }} retenu, années de développement {{ f.from }} à {{ f.to }}</label>
                  <input
                    [id]="id"
                    class="input num ac-factorInput"
                    inputmode="decimal"
                    autocomplete="off"
                    [placeholder]="f.estimated === null ? 'Obligatoire' : factor(f.estimated)"
                    [value]="selections()[j] ?? ''"
                    [attr.aria-invalid]="error ? true : null"
                    [attr.aria-describedby]="error ? id + '-error' : null"
                    (input)="selectFactor.emit({ basis: c.basis, index: j, value: $any($event.target).value })"
                  />
                  @if (error) {
                    <span [id]="id + '-error'" class="field-error" style="display: block">{{ error }}</span>
                  } @else if (f.source === 'SELECTED') {
                    <span class="ac-hint">Retenu : {{ factor(f.selected) }}</span>
                  }
                </td>
                <td class="num">{{ factor(c.cdf[j]) }}</td>
                <td class="num">{{ ratio(c.percentDeveloped[j], 1) }}</td>
              </tr>
            }
            <tr data-total="true">
              <th scope="row">Queue après {{ n }}</th>
              <td [attr.colspan]="latest() ? 4 : 3"></td>
              <td class="num">{{ factor(c.tail) }}</td>
              <td class="num">{{ factor(c.cdf[n - 1]) }}</td>
              <td class="num">{{ ratio(c.percentDeveloped[n - 1], 1) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="ac-note">
        Pondéré : Σ C(j+1) ÷ Σ C(j) ; simple : moyenne des coefficients de passage, avec leur plage ci-dessous. La CDF est le facteur cumulé à l'ultime à partir de cette année de développement : le produit des facteurs retenus suivants et de la queue. Les montants manquants sont exclus de chaque moyenne.
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
      `Coefficients d'âge à âge estimés et votre sélection. L'estimation ${AVERAGE_LABEL[this.results().averaging.method].toLowerCase()} est utilisée sauf si vous saisissez un facteur.`,
  );
}

@Component({
  selector: 'mtr-reserves-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    @let r = results().reserves;
    <section mtr-panel panelId="reserves" heading="Provisions par année de survenance" description="Chaque montant n'est compté qu'une fois : non payé = provisions dossier + IBNR. Montants en dinars.">
      @if (estimate(); as e) {
        <div class="table-wrap ac-rows ac-compact">
          <table class="data-table">
            <caption class="sr-only">Payé, provisions dossier, ultime, non payé et IBNR par année de survenance</caption>
            <thead>
              <tr>
                <th scope="col">Année de survenance</th>
                <th scope="col" class="num">Prime</th>
                <th scope="col" class="num">Payé</th>
                <th scope="col" class="num">Provision dossier</th>
                <th scope="col" class="num">Ultime</th>
                <th scope="col" class="num">Non payé</th>
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
        <div mtr-empty-state icon="info" heading="Méthode indisponible" [description]="reason()"></div>
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
      heading="Comparaison des méthodes"
      description="Totaux sur toutes les années de survenance. L'écart entre méthodes donne une première vue de l'incertitude d'estimation."
    >
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Ultime, non payé et IBNR totaux par méthode de provisionnement</caption>
          <thead>
            <tr>
              <th scope="col">Méthode</th>
              <th scope="col" class="num">Ultime</th>
              <th scope="col" class="num">Non payé</th>
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
      heading="Payé contre survenu"
      description="Ultimes de la chaîne de développement sur les deux bases. Un écart persistant indique un changement de vitesse de règlement ou de provision dossier."
    >
      @if (results().paidVsIncurred; as p) {
        <div class="table-wrap ac-rows ac-compact">
          <table class="data-table">
            <caption class="sr-only">Ultimes chaîne de développement payés et survenus par année de survenance</caption>
            <thead>
              <tr>
                <th scope="col">Année</th>
                <th scope="col" class="num">CD payés</th>
                <th scope="col" class="num">CD survenus</th>
                <th scope="col" class="num">Écart</th>
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
        <div mtr-empty-state icon="info" heading="Pas de triangle des survenus" description="Ajoutez le triangle des sinistres survenus pour comparer les deux chaînes de développement."></div>
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
    <section mtr-panel panelId="curves" heading="Schéma de développement" description="Part attendue de l'ultime atteinte à chaque année de développement, d'après les facteurs retenus.">
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
    const series: ChartSeries[] = [{ label: 'Payés, part de l\'ultime', values: results.chainLadder.paid.percentDeveloped, tone: 'brand' }];
    if (results.chainLadder.incurred) series.push({ label: 'Survenus, part de l\'ultime', values: results.chainLadder.incurred.percentDeveloped, tone: 'cyan', dashed: true });
    const last = results.chainLadder.paid.percentDeveloped;
    return {
      series,
      xLabels: ['Année 1', `Année ${n}`] as [string, string],
      summary: `Développement des payés de ${ratio(last[0], 0)} de l'ultime en année 1 à ${ratio(last[n - 1], 0)} en année ${n}${results.chainLadder.incurred ? ', avec le profil des survenus pour comparaison' : ''}.`,
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
    <section mtr-panel panelId="sensitivity" heading="Sensibilité" [description]="description()">
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Non payé total sous hypothèses alternatives et variation par rapport au scénario de base</caption>
          <thead>
            <tr>
              <th scope="col">Scénario</th>
              <th scope="col" class="num">Non payé</th>
              <th scope="col" class="num">Variation</th>
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
      <h3 class="ac-subhead">Un facteur à la fois</h3>
      <div class="table-wrap ac-rows ac-compact">
        <table class="data-table">
          <caption class="sr-only">Variation du non payé total de la chaîne de développement lorsqu'un facteur retenu augmente d'un pour cent</caption>
          <thead>
            <tr>
              <th scope="col">Facteur +1 %</th>
              <th scope="col" class="num">Variation CD payés</th>
              @if (incurred) {
                <th scope="col" class="num">Variation CD survenus</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (f of paidFactors(); track f.from; let j = $index) {
              <tr>
                <th scope="row">{{ f.from }} à {{ f.to }}</th>
                <td class="num">{{ signed(f.change) }}</td>
                @if (incurred) {
                  <td class="num">{{ signed(incurredFactors()[j]?.change) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="ac-note">Les premiers facteurs s'appliquent aux années de survenance les plus récentes, où se situe l'essentiel de la provision ; leur sélection compte donc le plus souvent le plus.</p>
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
    () => `Non payé total pour ${methodLabel(this.labels(), this.method()).toLowerCase()} lorsqu'une hypothèse change, le reste inchangé.`,
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
      heading="Paiements attendus par année calendaire"
      description="Montant non payé de la chaîne de développement payés réparti sur les années futures. Non actualisé, sans ajustement d'inflation : entrée passif pour l'adéquation actif–passif."
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
          seriesLabel="Paiements attendus"
          [summary]="summary()"
        ></figure>
      }
      <div class="table-wrap ac-rows" style="margin-top: var(--space-3)">
        <table class="data-table">
          <caption class="sr-only">Paiements de sinistres attendus par année calendaire future</caption>
          <thead>
            <tr>
              <th scope="col">Année calendaire</th>
              <th scope="col" class="num">Paiement attendu</th>
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
                  Après l'année de développement {{ results().origins.length }}
                  <span class="ac-hint">Facteur de queue ; calendrier non modélisé</span>
                </th>
                <td class="num">{{ tndWhole(c.afterLastDevelopmentYear) }}</td>
              </tr>
            }
            <tr data-total="true">
              <th scope="row">Total (égal au non payé CD payés)</th>
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
  protected readonly formatX = (v: number) => (v === this.first() ? `1 janv. ${v}` : `31 déc. ${v - 1}`);
  protected readonly summary = computed(() => {
    const c = this.results().cashFlows;
    const first = this.first();
    return `Paiements attendus de ${first} à ${first + c.periods.length - 1}, total ${tndWhole(c.total)} avec la queue.`;
  });
}

/* ---------- Saved runs ---------- */

@Component({
  selector: 'mtr-reserving-runs-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, IconComponent],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="runs" heading="Vos calculs de provisionnement" [description]="description()">
      <form class="ac-saveForm" novalidate (submit)="submit($event)">
        <div class="field">
          <label class="field-label" for="rs-run-label">Libellé du calcul</label>
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
    this.trimmed() !== '' && !RUN_LABEL.test(this.trimmed()) ? "Utilisez lettres, chiffres, espaces et . , ' & ( ) % + / - (80 caractères au plus)." : null,
  );
  protected readonly dash = DASH;
  protected readonly tndShort = tndShort;
  protected readonly createdAt = (iso: string) => new Date(iso).toLocaleString('fr-FR');
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
  'Payé P       paiements de sinistres à ce jour (cumulés)',
  'Déclaré I    survenu = payé + provisions dossier sinistre par sinistre',
  'Ultime U     coût total estimé de l\'année de survenance',
  'Non payé     U − P = provisions dossier + IBNR     (chaque montant compté une fois)',
  'IBNR         U − I : sinistres pas encore déclarés + développement futur des sinistres connus (IBNER)',
  '',
  'Coefficient  f(i, j) = C(i, j+1) / C(i, j) ; les montants manquants sont exclus',
  'Pondéré      f(j) = Σ C(i, j+1) / Σ C(i, j) sur les années avec les deux montants',
  'À l\'ultime   CDF(j) = f(j) · f(j+1) · … · f(n−1) · queue',
  'Chaîne dévelop. U = dernier montant × CDF à son âge',
  'Ratio S/P    U = prime × ratio sinistres/primes attendu',
  'B–F          U = dernier + prime × RSP × (1 − 1 / CDF)',
].join('\n');

@Component({
  selector: 'mtr-reserving-method-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="method" heading="Définitions et méthodes">
      <details class="ac-explain">
        <summary>Afficher les définitions et formules</summary>
        <pre class="ac-formula">{{ method }}</pre>
        <p class="ac-note">
          Triangles annuels uniquement. Les meilleures estimations ne sont pas actualisées, sans ajustement d'inflation ni marge de risque, et ne comportent pas de mesure de variabilité (Mack ou bootstrap ne sont pas encore implémentés).
          L'IBNER est inclus dans l'IBNR car le séparer nécessite des données sinistre par sinistre.
        </p>
      </details>
    </section>
  `,
})
export class ReservingMethodNotesComponent {
  protected readonly method = RESERVING_METHOD;
}
