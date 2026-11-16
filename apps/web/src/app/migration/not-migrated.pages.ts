import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthLayoutComponent } from '../auth/auth-layout/auth-layout.component';
import { findNavItem } from '../core/navigation/workspace-nav';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';

const NOTICE =
  "Ce chemin ne fait pas partie de l'application active. Utilisez la navigation de l'espace de travail pour les modules opérationnels, ou ouvrez un aperçu conçu depuis la barre latérale lorsqu'il est marqué Aperçu.";

function currentPath(router: Router) {
  return toSignal(
    router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0]),
    ),
    { initialValue: router.url.split(/[?#]/)[0] },
  );
}

/** Fallback for workspace URLs that are neither live nor registered previews. */
@Component({
  selector: 'mtr-workspace-not-migrated',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeadingComponent],
  host: { style: 'display: contents' },
  template: `
    <div class="page-shell">
      <mtr-page-heading [eyebrow]="location()?.group?.label ?? 'Espace de travail'" [title]="location()?.item?.label ?? 'Non disponible'" />
      <section class="card-panel" role="status">
        <p style="margin: 0">{{ notice }}</p>
      </section>
    </div>
  `,
})
export class WorkspaceNotMigratedPage {
  private readonly pathname = currentPath(inject(Router));
  protected readonly location = computed(() => findNavItem(this.pathname()));
  protected readonly notice = NOTICE;
}

/** Any other public route (unknown paths…). */
@Component({
  selector: 'mtr-public-not-migrated',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthLayoutComponent],
  host: { style: 'display: contents' },
  template: `
    <mtr-auth-layout
      title="Page introuvable"
      lead="Cette adresse ne correspond à aucun écran de Market Trading Room."
      [showFooter]="true"
    >
      <div class="notfound-actions">
        <a routerLink="/" class="btn btn-primary">Accueil</a>
        <a routerLink="/login" class="btn btn-secondary">Connexion</a>
      </div>
      <ng-container ngProjectAs="[authFooter]">
        <span>Besoin d'aide ? Retournez à l'accueil ou connectez-vous à votre espace.</span>
      </ng-container>
    </mtr-auth-layout>
  `,
  styles: `
    .notfound-actions {
      display: grid;
      gap: 0.65rem;
    }
    .notfound-actions .btn {
      justify-content: center;
    }
  `,
})
export class PublicNotMigratedPage {}
