import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import {
  assertCanExecuteSimulation,
  assertCanManageUsers,
  assertCanModifyOwn,
  assertCanReadOwn,
  canExecuteSimulation,
  canManageLearningContent,
  canManageStressScenarios,
  canManageUsers,
  canModifyOwnResource,
  canReadOwnResource,
  ownedBy,
  PolicyActor,
} from './ownership.policy';

function actor(partial: Partial<PolicyActor> = {}): PolicyActor {
  return { id: 'u1', role: UserRole.INVESTOR, status: UserStatus.ACTIVE, ...partial };
}

const admin = actor({ id: 'admin', role: UserRole.ADMIN });
const mine = { ownerId: 'u1' };
const theirs = { ownerId: 'u2' };

function codeOf(fn: () => void): { status: number; errorCode?: string } {
  try {
    fn();
  } catch (err) {
    const e = err as HttpException;
    return { status: e.getStatus(), errorCode: (e.getResponse() as { errorCode?: string }).errorCode };
  }
  throw new Error('expected a throw');
}

describe('ownership policy — permissions matrix (§6)', () => {
  it('lets owners read and modify their own resources', () => {
    expect(canReadOwnResource(actor(), mine)).toBe(true);
    expect(canModifyOwnResource(actor(), mine)).toBe(true);
  });

  it("denies another investor's portfolio to investors and, by default, to admins", () => {
    expect(canReadOwnResource(actor(), theirs)).toBe(false);
    expect(canReadOwnResource(admin, theirs)).toBe(false);
    expect(canModifyOwnResource(admin, theirs)).toBe(false);
  });

  it('denies suspended or deactivated owners', () => {
    expect(canReadOwnResource(actor({ status: UserStatus.SUSPENDED }), mine)).toBe(false);
    expect(canModifyOwnResource(actor({ status: UserStatus.DEACTIVATED }), mine)).toBe(false);
  });

  it('restricts account management, learning content and stress scenarios to active admins', () => {
    expect(canManageUsers(admin)).toBe(true);
    expect(canManageUsers(actor())).toBe(false);
    expect(canManageUsers(actor({ role: UserRole.ADMIN, status: UserStatus.SUSPENDED }))).toBe(false);
    expect(canManageLearningContent(admin)).toBe(true);
    expect(canManageLearningContent(actor())).toBe(false);
    expect(canManageStressScenarios(admin)).toBe(true);
    expect(canManageStressScenarios(actor())).toBe(false);
  });

  it('allows simulations only for the owner and within quota', () => {
    expect(canExecuteSimulation(actor(), { maxConcurrentRuns: 2, activeRuns: 1 }, mine)).toBe(true);
    expect(canExecuteSimulation(actor(), { maxConcurrentRuns: 2, activeRuns: 2 }, mine)).toBe(false);
    expect(canExecuteSimulation(actor(), { maxConcurrentRuns: 0, activeRuns: 0 }, mine)).toBe(false);
    expect(canExecuteSimulation(admin, { maxConcurrentRuns: 5, activeRuns: 0 }, theirs)).toBe(false);
  });
});

describe('ownership policy — assertions (§4.15)', () => {
  it('answers 404 RESOURCE_NOT_FOUND for both missing and foreign resources', () => {
    const missing = codeOf(() => assertCanReadOwn(actor(), null));
    const foreign = codeOf(() => assertCanReadOwn(actor(), theirs));
    expect(missing).toEqual({ status: 404, errorCode: 'RESOURCE_NOT_FOUND' });
    expect(foreign).toEqual(missing);
    expect(() => assertCanModifyOwn(admin, theirs)).toThrow(NotFoundException);
  });

  it('reports quota exhaustion as 403 only to the owner', () => {
    expect(codeOf(() => assertCanExecuteSimulation(actor(), { maxConcurrentRuns: 1, activeRuns: 1 }, mine))).toEqual({
      status: 403,
      errorCode: 'SIMULATION_QUOTA_EXCEEDED',
    });
    expect(() => assertCanExecuteSimulation(actor(), { maxConcurrentRuns: 1, activeRuns: 0 }, theirs)).toThrow(
      NotFoundException,
    );
  });

  it('throws HTTP exceptions, never plain errors that would become 500s', () => {
    expect(() => assertCanManageUsers(actor())).toThrow(ForbiddenException);
  });

  it('scopes queries to the caller', () => {
    expect(ownedBy(actor(), 'res-1')).toEqual({ id: 'res-1', userId: 'u1' });
  });
});
