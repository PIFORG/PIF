'use client';

import Link from 'next/link';
import type { AdminUserListItem } from '@/lib/api/types';
import { AccountStatusBadge } from '@/components/layout/AccountStatusBadge';

interface AdminUserTableProps {
  users: AdminUserListItem[];
  emptyMessage?: string;
}

export function AdminUserTable({
  users,
  emptyMessage = 'No users match the current filters.',
}: AdminUserTableProps) {
  if (users.length === 0) {
    return <p role="status">{emptyMessage}</p>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">MFA</th>
            <th scope="col">Created</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                {user.firstName} {user.lastName}
              </td>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>
                <AccountStatusBadge status={user.status} />
              </td>
              <td>{user.mfaEnabled ? 'On' : 'Off'}</td>
              <td>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                }).format(new Date(user.createdAt))}
              </td>
              <td>
                <Link href={`/admin/users/${user.id}`}>View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
