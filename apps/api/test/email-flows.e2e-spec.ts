import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthTokenType, UserStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Transactional email flows against a real PostgreSQL `_test` database, with the preview
 * transport capturing every message so the test follows links exactly as a user would.
 */
describe('Transactional email flows (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const previewDir = mkdtempSync(path.join(tmpdir(), 'mtrs-email-e2e-'));
  const password = 'Mail-e2e-pass-7!';
  const origin = 'http://localhost:3000';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MAIL_TRANSPORT = 'preview';
    process.env.MAIL_PREVIEW_DIR = previewDir;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? 'api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    rmSync(previewDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.mfaRecoveryCode.deleteMany();
    await prisma.authToken.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.userPreferences.deleteMany();
    await prisma.user.deleteMany();
    for (const f of readdirSync(previewDir)) rmSync(path.join(previewDir, f), { force: true });
  });

  const post = (url: string) => request(baseUrl).post(url).set('Origin', origin);

  async function captured(to: string, template: string, atLeast = 1) {
    for (let i = 0; i < 40; i += 1) {
      const metas = readdirSync(previewDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(path.join(previewDir, f), 'utf8')))
        .filter((m) => m.to === to && m.template === template)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      if (metas.length >= atLeast || (atLeast === 0 && i >= 5)) {
        return metas.map((m) => ({
          ...m,
          text: readFileSync(path.join(previewDir, `${m.id}.txt`), 'utf8') as string,
          eml: readFileSync(path.join(previewDir, `${m.id}.eml`), 'utf8') as string,
        }));
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`expected at least ${atLeast} "${template}" message(s)`);
  }

  // Sends are fire-and-forget; let in-flight writes finish before the next test cleans up.
  afterEach(() => new Promise((r) => setTimeout(r, 400)));

  function tokenFrom(text: string, route: string): string {
    const m = new RegExp(`http://localhost:3000${route}\\?token=([A-Za-z0-9_%-]+)`).exec(text);
    if (!m) throw new Error(`no ${route} link`);
    return decodeURIComponent(m[1]);
  }

  async function register(email: string) {
    await post('/api/auth/register')
      .send({ email, password, passwordConfirmation: password, firstName: 'Mia', lastName: 'Mailer' })
      .expect(201);
    const [mail] = await captured(email, 'verify-email');
    return tokenFrom(mail.text, '/verify-email');
  }

  it('registration email link verifies the account in PostgreSQL exactly once', async () => {
    const email = 'mia@example.test';
    const raw = await register(email);

    const before = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(before.emailVerified).toBe(false);
    expect(before.status).toBe(UserStatus.PENDING_VERIFICATION);

    const stored = await prisma.authToken.findFirstOrThrow({
      where: { userId: before.id, type: AuthTokenType.EMAIL_VERIFICATION },
    });
    expect(stored.tokenHash).not.toContain(raw);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.usedAt).toBeNull();

    const blocked = await post('/api/auth/login').send({ email, password }).expect(403);
    expect(blocked.body.errorCode).toBe('EMAIL_NOT_VERIFIED');

    await post('/api/auth/verify-email').send({ token: raw }).expect(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(after.emailVerified).toBe(true);
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(after.status).toBe(UserStatus.ACTIVE);
    expect((await prisma.authToken.findUniqueOrThrow({ where: { id: stored.id } })).usedAt).not.toBeNull();

    const reuse = await post('/api/auth/verify-email').send({ token: raw }).expect(400);
    expect(reuse.body.errorCode).toBe('TOKEN_INVALID');

    await post('/api/auth/login').send({ email, password }).expect(200);
    expect(await captured(email, 'welcome')).toHaveLength(1);
  });

  it('concurrent confirmations of one token produce exactly one success', async () => {
    const raw = await register('race@example.test');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post('/api/auth/verify-email').send({ token: raw })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
  });

  it('resend honours the cooldown and answers identically for unknown addresses', async () => {
    const email = 'cool@example.test';
    await register(email);
    const known = await post('/api/auth/resend-verification').send({ email }).expect(200);
    const unknown = await post('/api/auth/resend-verification').send({ email: 'nobody@example.test' }).expect(200);
    expect(known.body).toEqual(unknown.body);
    await new Promise((r) => setTimeout(r, 300));
    expect(await captured(email, 'verify-email')).toHaveLength(1);
    expect(await captured('nobody@example.test', 'verify-email', 0)).toHaveLength(0);
  });

  it('a newer verification link supersedes the older one', async () => {
    const email = 'newer@example.test';
    const first = await register(email);
    await prisma.authToken.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
    await post('/api/auth/resend-verification').send({ email }).expect(200);
    const mails = await captured(email, 'verify-email', 2);
    expect(mails).toHaveLength(2);
    const second = tokenFrom(mails[1].text, '/verify-email');
    await post('/api/auth/verify-email').send({ token: first }).expect(400);
    await post('/api/auth/verify-email').send({ token: second }).expect(200);
  });

  it('password reset works once, revokes sessions and sends the completion notice', async () => {
    const email = 'reset@example.test';
    await post('/api/auth/verify-email').send({ token: await register(email) }).expect(200);
    await post('/api/auth/login').send({ email, password }).expect(200);

    await post('/api/auth/forgot-password').send({ email }).expect(200);
    const [resetMail] = await captured(email, 'reset-password');
    expect(resetMail.text).toContain('expires in 30 minutes and can be used only once');
    const raw = tokenFrom(resetMail.text, '/reset-password');

    const next = 'Reset-e2e-pass-8?';
    await post('/api/auth/reset-password').send({ token: raw, password: next, passwordConfirmation: next }).expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    const again = await post('/api/auth/reset-password')
      .send({ token: raw, password: 'Other-pass-9!', passwordConfirmation: 'Other-pass-9!' })
      .expect(400);
    expect(again.body.errorCode).toBe('TOKEN_INVALID');

    await post('/api/auth/login').send({ email, password }).expect(401);
    await post('/api/auth/login').send({ email, password: next }).expect(200);
    const [changed] = await captured(email, 'password-changed');
    expect(changed.text).toContain('Every device was signed out');
  });

  it('forgot-password for an unknown address is generic and sends nothing', async () => {
    const res = await post('/api/auth/forgot-password').send({ email: 'ghost@example.test' }).expect(200);
    expect(res.body.message).toMatch(/If an account exists/);
    expect(readdirSync(previewDir)).toHaveLength(0);
  });

  it('expired links are rejected without changing the account', async () => {
    const email = 'late@example.test';
    const raw = await register(email);
    await prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await post('/api/auth/verify-email').send({ token: raw }).expect(400);
    expect(res.body.errorCode).toBe('TOKEN_INVALID');
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified).toBe(false);
  });

  it('never stores raw tokens in audit events or returns them in responses', async () => {
    const email = 'audit@example.test';
    const regRes = await post('/api/auth/register')
      .send({ email, password, passwordConfirmation: password, firstName: 'Ann', lastName: 'Audit' })
      .expect(201);
    const [mail] = await captured(email, 'verify-email');
    const raw = tokenFrom(mail.text, '/verify-email');
    const verifyRes = await post('/api/auth/verify-email').send({ token: raw }).expect(200);
    expect(JSON.stringify(regRes.body)).not.toContain(raw);
    expect(JSON.stringify(verifyRes.body)).not.toContain(raw);
    const audit = await prisma.auditEvent.findMany();
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(raw);
  });
});
