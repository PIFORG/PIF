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

/** Any other public route (landing page, unknown paths…). */
@Component({
  selector: 'mtr-public-not-migrated',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthLayoutComponent],
  host: { style: 'display: contents' },
  template: `
    <mtr-auth-layout title="Pas encore disponible" [lead]="notice" [showFooter]="true">
      <ng-container ngProjectAs="[authFooter]">
        <span><a routerLink="/login">Retour à la connexion</a></span>
      </ng-container>
    </mtr-auth-layout>
  `,
})
export class PublicNotMigratedPage {
  protected readonly notice = NOTICE;
}
