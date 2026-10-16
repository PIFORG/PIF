import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

/**
 * Resource-level authorization contract for every private, user-owned resource
 * (portfolios, orders, trades, watchlists, backtests, AI jobs, learning progress, quiz
 * attempts, stress-test and actuarial runs, ...). Route guards are only a coarse first gate;
 * services must call these policies AND scope their queries with `ownedBy()`.
 *
 * Admins do NOT get implicit access to other people's private resources (§6).
 */
export type PolicyActor = {
  id: string;
  role: UserRole;
  status: UserStatus;
};

export type OwnedResource = { ownerId: string };

/** Per-user limits a simulation engine must supply; never trust client-sent values. */
export type SimulationQuota = {
  maxConcurrentRuns: number;
  activeRuns: number;
};

export function isAdmin(actor: Pick<PolicyActor, 'role'>): boolean {
  return actor.role === UserRole.ADMIN;
}

export function isActiveAccount(actor: Pick<PolicyActor, 'status'>): boolean {
  return actor.status === UserStatus.ACTIVE;
}

/** Owner only — regardless of role. */
export function canReadOwnResource(actor: PolicyActor, resource: OwnedResource): boolean {
  return isActiveAccount(actor) && actor.id === resource.ownerId;
}

/** Owner only — regardless of role. */
export function canModifyOwnResource(actor: PolicyActor, resource: OwnedResource): boolean {
  return isActiveAccount(actor) && actor.id === resource.ownerId;
}

/** Owner only, and only while under the per-user concurrency quota. */
export function canExecuteSimulation(
  actor: PolicyActor,
  quota: SimulationQuota,
  resource: OwnedResource,
): boolean {
  return (
    canModifyOwnResource(actor, resource) &&
    quota.maxConcurrentRuns > 0 &&
    quota.activeRuns < quota.maxConcurrentRuns
  );
}

export function canManageUsers(actor: PolicyActor): boolean {
  return isAdmin(actor) && isActiveAccount(actor);
}

export function canViewAuditEvents(actor: PolicyActor): boolean {
  return canManageUsers(actor);
}

/** Platform-level content: only when the corresponding module exists (none yet). */
export function canManageLearningContent(actor: PolicyActor): boolean {
  return isAdmin(actor) && isActiveAccount(actor);
}

export function canManageStressScenarios(actor: PolicyActor): boolean {
  return isAdmin(actor) && isActiveAccount(actor);
}

/**
 * Prisma `where` fragment that scopes a lookup to the caller. Use it in the query itself so
 * a foreign ID and a missing ID are indistinguishable (both return nothing → 404).
 */
export function ownedBy(actor: Pick<PolicyActor, 'id'>, id: string): { id: string; userId: string } {
  return { id, userId: actor.id };
}

export function resourceNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Resource not found', errorCode: 'RESOURCE_NOT_FOUND' });
}

/** Same 404 for "does not exist" and "belongs to someone else" (no ownership discovery). */
export function assertCanReadOwn(actor: PolicyActor, resource: OwnedResource | null | undefined): void {
  if (!resource || !canReadOwnResource(actor, resource)) throw resourceNotFound();
}

export function assertCanModifyOwn(actor: PolicyActor, resource: OwnedResource | null | undefined): void {
  if (!resource || !canModifyOwnResource(actor, resource)) throw resourceNotFound();
}

export function assertCanExecuteSimulation(
  actor: PolicyActor,
  quota: SimulationQuota,
  resource: OwnedResource | null | undefined,
): void {
  if (!resource || !canModifyOwnResource(actor, resource)) throw resourceNotFound();
  if (!canExecuteSimulation(actor, quota, resource)) {
    throw new ForbiddenException({
      message: 'Simulation limit reached. Wait for a running simulation to finish.',
      errorCode: 'SIMULATION_QUOTA_EXCEEDED',
    });
  }
}

export function assertCanManageUsers(actor: PolicyActor): void {
  if (!canManageUsers(actor)) {
    throw new ForbiddenException({ message: 'Administrator access required', errorCode: 'FORBIDDEN' });
  }
}
