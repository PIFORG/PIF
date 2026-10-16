import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common/crypto/password.util';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth identity e2e', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'E2eUniqueStrongPass!99';
  const adminPassword = 'E2eAdminStrongPass!!1';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? 'api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.mfaRecoveryCode.deleteMany();
    await prisma.authToken.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.userPreferences.deleteMany();
    await prisma.user.deleteMany();
  });

  async function registerAndActivate(email: string) {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        firstName: 'Test',
        lastName: 'User',
        password,
        passwordConfirmation: password,
      })
      .expect(201);

    await prisma.user.update({
      where: { email },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
      },
    });
  }

  function login(email: string, pwd = password) {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: pwd });
  }

  function extractCookie(res: request.Response, name: string): string | null {
    const raw = res.headers['set-cookie'];
    if (!raw) return null;
    const list = Array.isArray(raw) ? raw : [raw];
    const found = list.find((c) => c.startsWith(`${name}=`));
    if (!found) return null;
    return found.split(';')[0];
  }

  it('registers, logs in, refreshes, and returns public user without secrets', async () => {
    await registerAndActivate('investor@example.com');

    const loginRes = await login('investor@example.com').expect(200);
    expect(loginRes.body.accessToken).toBeDefined();
    expect(loginRes.body.user.email).toBe('investor@example.com');
    expect(loginRes.body.user.passwordHash).toBeUndefined();
    expect(loginRes.body.user.mfaSecretEncrypted).toBeUndefined();

    const refreshCookie = extractCookie(loginRes, 'mtrs_refresh');
    expect(refreshCookie).toBeTruthy();

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('investor@example.com');
    expect(me.body.role).toBe(UserRole.INVESTOR);

    // JWT `iat` has one-second resolution; identical claims in the same second sign identically.
    await new Promise((r) => setTimeout(r, 1100));
    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie!)
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(refreshRes.body.accessToken).toBeDefined();
    expect(refreshRes.body.accessToken).not.toEqual(loginRes.body.accessToken);
  });

  it('detects refresh token reuse and revokes the session', async () => {
    await registerAndActivate('reuse@example.com');
    const loginRes = await login('reuse@example.com').expect(200);
    const oldCookie = extractCookie(loginRes, 'mtrs_refresh')!;

    const firstRefresh = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', oldCookie)
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(firstRefresh.body.accessToken).toBeDefined();

    // Simulate a replay well after rotation (outside the benign concurrent-tab window).
    await prisma.authToken.updateMany({
      where: { replacedById: { not: null } },
      data: { usedAt: new Date(Date.now() - 60_000) },
    });

    const replay = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', oldCookie)
      .set('Origin', 'http://localhost:3000')
      .expect(401);
    expect(replay.body.errorCode).toBe('REFRESH_REUSE_DETECTED');
    expect(replay.body.accessToken).toBeUndefined();

    // Access tokens tied to the revoked stable session fail immediately.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${firstRefresh.body.accessToken}`)
      .expect(401);

    const newCookie = extractCookie(firstRefresh, 'mtrs_refresh');
    if (newCookie) {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', newCookie)
        .set('Origin', 'http://localhost:3000')
        .expect(401);
    }
  });

  it('treats concurrent tab refreshes as benign: one winner, no leak, session kept', async () => {
    await registerAndActivate('tabs@example.com');
    const loginRes = await login('tabs@example.com').expect(200);
    const cookie = extractCookie(loginRes, 'mtrs_refresh')!;

    const results = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post('/api/auth/refresh')
          .set('Cookie', cookie)
          .set('Origin', 'http://localhost:3000'),
      ),
    );
    const winners = results.filter((r) => r.status === 200);
    const losers = results.filter((r) => r.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].status).toBe(401);
    expect(losers[0].body.errorCode).toBe('REFRESH_SUPERSEDED');
    expect(losers[0].body.accessToken).toBeUndefined();
    // Loser must not clear the winner's freshly set cookie.
    expect(extractCookie(losers[0], 'mtrs_refresh')).toBeNull();

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${winners[0].body.accessToken}`)
      .expect(200);
  });

  it('enforces ownership on dashboard context (self only)', async () => {
    await registerAndActivate('owner@example.com');
    const ownerLogin = await login('owner@example.com').expect(200);

    const ctx = await request(app.getHttpServer())
      .get('/api/users/me/dashboard-context')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .expect(200);
    expect(ctx.body.user.email).toBe('owner@example.com');
  });

  it('allows admin user listing and blocks investors', async () => {
    await registerAndActivate('investor2@example.com');
    const investorLogin = await login('investor2@example.com').expect(200);

    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${investorLogin.body.accessToken}`)
      .expect(403);

    const adminHash = await hashPassword(adminPassword);
    const admin = await prisma.user.create({
      data: {
        email: 'admin@example.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: adminHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        preferences: { create: {} },
      },
    });

    const adminLogin = await login('admin@example.com', adminPassword).expect(200);
    const list = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .expect(200);

    expect(list.body.total).toBeGreaterThanOrEqual(2);
    expect(list.body.items.every((u: { passwordHash?: string }) => !u.passwordHash)).toBe(
      true,
    );

    const overview = await request(app.getHttpServer())
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .expect(200);
    expect(overview.body.users.total).toBeGreaterThanOrEqual(2);

    const demote = await request(app.getHttpServer())
      .patch(`/api/admin/users/${admin.id}/role`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .set('Origin', 'http://localhost:3000')
      .send({ role: UserRole.INVESTOR, password: adminPassword })
      .expect(403);
    expect(demote.body.errorCode).toBe('SELF_DEMOTION_FORBIDDEN');

    const selfSuspend = await request(app.getHttpServer())
      .patch(`/api/admin/users/${admin.id}/status`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'SUSPENDED', reason: 'self test' })
      .expect(403);
    expect(selfSuspend.body.errorCode).toBe('SELF_STATUS_CHANGE_FORBIDDEN');

    const investor = await prisma.user.findUniqueOrThrow({ where: { email: 'investor2@example.com' } });
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${investor.id}/status`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(400);
    const suspended = await request(app.getHttpServer())
      .patch(`/api/admin/users/${investor.id}/status`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .send({ status: 'SUSPENDED', reason: 'policy review' })
      .expect(200);
    expect(suspended.body.user.status).toBe('SUSPENDED');
    expect(suspended.body.user).not.toHaveProperty('preferences');
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${investorLogin.body.accessToken}`)
      .expect(401);

    const audit = await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .query({ eventType: 'ADMIN_STATUS_CHANGE', subjectUserId: investor.id })
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .expect(200);
    expect(audit.body.items[0].context).toEqual({ from: 'ACTIVE', to: 'SUSPENDED', reason: 'policy review' });
  });

  it('rejects weak passwords on register', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'weak@example.com',
        firstName: 'W',
        lastName: 'P',
        password: 'passwordpassword',
        passwordConfirmation: 'passwordpassword',
      })
      .expect(400);
  });
});
