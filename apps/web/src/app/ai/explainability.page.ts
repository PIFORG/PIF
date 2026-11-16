import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AiApi, type AiExplanation, type AiModelCard } from '../core/api/ai-api';
import { describeApiError } from '../core/api/errors';
import { formatNumber } from '../core/format/finance';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';

@Component({
  selector: 'mtr-explainability-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <div class="page-shell ai-lab ai-xaiDesk">
      <header class="ai-xaiTop">
        <div>
          <p class="eyebrow">Analyses</p>
          <h1 class="ai-xaiTitle">Comprendre les prévisions</h1>
          <p class="ai-xaiLede">
            Voyez ce que le modèle a prédit, quels facteurs ont poussé le résultat à la hausse ou à la baisse, et quelles en sont les limites.
          </p>
        </div>
        <a routerLink="/ai" class="btn btn-ghost btn-sm">Retour aux prévisions</a>
      </header>

      @if (error()) {
        <div class="form-error-banner" role="alert">{{ error() }}</div>
      }

      <div class="ai-xaiBoard">
        @if (model(); as m) {
          <section mtr-panel panelId="result" heading="Résultat expliqué" description="Modèle, méthode et provenance des données.">
            <dl class="ai-xaiMeta">
              <div><dt>Modèle</dt><dd>{{ m.title }}</dd></div>
              <div><dt>Identifiant</dt><dd class="num">{{ m.id }}</dd></div>
              <div><dt>Méthode</dt><dd>{{ m.method }}</dd></div>
              <div><dt>Jeu de données</dt><dd>{{ m.dataProvenance }}</dd></div>
              @if (explanation(); as ex) {
                <div><dt>Prédiction</dt><dd class="num">{{ formatNumber(ex.prediction, 5) }}</dd></div>
                <div><dt>Référence</dt><dd class="num">{{ formatNumber(ex.baseline, 5) }}</dd></div>
              }
            </dl>
          </section>

          <section mtr-panel panelId="global" heading="Importance des variables" [description]="m.method">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th scope="col">Variable</th>
                    <th scope="col" class="num">Importance</th>
                    <th scope="col" class="num">Écart-type</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of m.globalImportance; track f.feature) {
                    <tr>
                      <td>{{ f.feature }}</td>
                      <td class="num">{{ formatNumber(f.importanceMean, 5) }}</td>
                      <td class="num">{{ formatNumber(f.importanceStd, 5) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (explanation(); as ex) {
          <section mtr-panel panelId="local" heading="Contributions" description="Décomposition exacte de la dernière prédiction de test — positives et négatives.">
            <p class="ai-xaiSummary">{{ ex.summary }}</p>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th scope="col">Variable</th>
                    <th scope="col" class="num">Contribution</th>
                    <th scope="col">Sens</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of ex.contributions; track c.feature) {
                    <tr [attr.data-dir]="c.direction">
                      <td>{{ c.feature }}</td>
                      <td class="num">{{ formatNumber(c.contribution, 5) }}</td>
                      <td>{{ c.direction === 'HAUSSE_PREDICTION' ? 'Hausse' : 'Baisse' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section mtr-panel panelId="interpretation" heading="Interprétation" description="Limites et lecture prudente de l'explication.">
            <ul class="ai-limits">
              @for (l of ex.limitations; track l) {
                <li>{{ l }}</li>
              }
            </ul>
            <p class="ai-muted" style="margin-top: 0.75rem">
              Méthodologie : attributions locales de type Shapley (SHAP) sur un modèle entraîné avec des séries synthétiques — utile pour comprendre une prédiction, pas pour certifier un marché réel.
            </p>
          </section>
        }
      </div>
    </div>
  `,
  styleUrl: './ai-lab.page.css',
})
export class ExplainabilityPage {
  private readonly api = inject(AiApi);
  private destroyed = false;
  protected readonly model = signal<AiModelCard | null>(null);
  protected readonly explanation = signal<AiExplanation | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly formatNumber = formatNumber;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void Promise.all([this.api.model('market-return-gbm'), this.api.explanation('insight-dernier-test')])
      .then(([model, explanation]) => {
        if (this.destroyed) return;
        this.model.set(model);
        this.explanation.set(explanation);
      })
      .catch((err) => !this.destroyed && this.error.set(describeApiError(err, 'Impossible de charger les explications.')));
  }
}
