import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

@Component({
  selector: 'mtr-unauthorized-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthLayoutComponent],
  host: { style: 'display: contents' },
  template: `
    <mtr-auth-layout title="Accès refusé" lead="Cette zone n'est pas disponible pour votre compte." [showFooter]="true">
      <p class="unauth-note">Contactez un administrateur si vous pensez qu'il s'agit d'une erreur.</p>
      <div class="unauth-actions">
        <a routerLink="/dashboard" class="btn btn-primary">Tableau de bord</a>
        <a routerLink="/login" class="btn btn-secondary">Autre compte</a>
      </div>
      <ng-container ngProjectAs="[authFooter]">
        <a routerLink="/">Retour à l'accueil</a>
      </ng-container>
    </mtr-auth-layout>
  `,
  styles: `
    .unauth-note {
      margin: 0;
      font-size: 0.875rem;
      color: var(--mtr-text-2);
    }
    .unauth-actions {
      display: grid;
      gap: 0.65rem;
    }
    .unauth-actions .btn {
      justify-content: center;
    }
  `,
})
export class UnauthorizedPage {}
