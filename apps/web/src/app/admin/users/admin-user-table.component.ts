import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AdminUserListItem } from '../../core/api/types';
import { AccountStatusBadgeComponent } from '../../shared/account-status-badge.component';

@Component({
  selector: 'mtr-admin-user-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AccountStatusBadgeComponent],
  host: { style: 'display: contents' },
  template: `
    @if (users().length === 0) {
      <p role="status">{{ emptyMessage() }}</p>
    } @else {
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Courriel</th>
              <th scope="col">Rôle</th>
              <th scope="col">Statut</th>
              <th scope="col">MFA</th>
              <th scope="col">Créé</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (user of users(); track user.id) {
              <tr>
                <td>{{ user.firstName }} {{ user.lastName }}</td>
                <td>{{ user.email }}</td>
                <td>{{ user.role }}</td>
                <td><mtr-account-status-badge [status]="user.status" /></td>
                <td>{{ user.mfaEnabled ? 'Activée' : 'Désactivée' }}</td>
                <td>{{ formatDate(user.createdAt) }}</td>
                <td><a [routerLink]="'/admin/users/' + user.id">Voir</a></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class AdminUserTableComponent {
  readonly users = input.required<AdminUserListItem[]>();
  readonly emptyMessage = input('Aucun utilisateur ne correspond aux filtres actuels.');

  protected formatDate(value: string): string {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));
  }
}
