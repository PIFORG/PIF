import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'mtr-unauthorized-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { style: 'display: contents' },
  template: `
    <div class="page-shell" style="max-width: 560px">
      <h1>Accès refusé</h1>
      <p>
        Vous n'avez pas l'autorisation de consulter cette zone, ou le statut de votre compte bloque l'accès. Contactez un
        administrateur si vous pensez qu'il s'agit d'une erreur.
      </p>
      <div style="display: flex; gap: 0.75rem; flex-wrap: wrap">
        <a routerLink="/dashboard" class="btn btn-primary">Aller au tableau de bord</a>
        <a routerLink="/login" class="btn btn-secondary">Se connecter avec un autre compte</a>
      </div>
    </div>
  `,
})
export class UnauthorizedPage {}
