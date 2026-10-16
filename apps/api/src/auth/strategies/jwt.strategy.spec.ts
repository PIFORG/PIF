import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

function setup(user: Record<string, unknown> | null) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn() },
    authSession: {
      findFirst: jest.fn().mockResolvedValue({ id: 's1', lastSeenAt: new Date() }),
      update: jest.fn(),
    },
  };
  const config = {
    getOrThrow: (key: string) =>
      ({ 'jwt.accessSecret': 'unit-test-access-secret-0123456789abcdef', 'jwt.issuer': 'i', 'jwt.audience': 'a' })[
        key
      ],
  };
  return new JwtStrategy(config as unknown as ConfigService, prisma as unknown as PrismaService);
}

const activeUser = {
  id: 'u1',
  status: UserStatus.ACTIVE,
  emailVerified: true,
  deletedAt: null,
  securityVersion: 2,
  lastActiveAt: new Date(),
  lockedUntil: null as Date | null,
};

describe('JwtStrategy.validate', () => {
  it('keeps existing sessions working while new sign-ins are locked out (C4)', async () => {
    const strategy = setup({ ...activeUser, lockedUntil: new Date(Date.now() + 60_000) });
    await expect(strategy.validate({ sub: 'u1', sid: 's1', sv: 2 })).resolves.toMatchObject({
      id: 'u1',
      sessionId: 's1',
    });
  });

  it('rejects tokens minted before a credential rotation', async () => {
    const strategy = setup(activeUser);
    const err = await strategy.validate({ sub: 'u1', sid: 's1', sv: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getResponse()).toMatchObject({ errorCode: 'CREDENTIALS_ROTATED' });
  });

  it('rejects suspended accounts immediately', async () => {
    const strategy = setup({ ...activeUser, status: UserStatus.SUSPENDED });
    const err = await strategy.validate({ sub: 'u1', sid: 's1', sv: 2 }).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(401);
  });
});
