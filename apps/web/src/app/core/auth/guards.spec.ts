import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { User } from '../api/types';
import { AuthService, type AuthStatus } from './auth.service';
import { accessRedirect, adminGuard } from './guards';

@Component({ template: 'admin area' })
class AdminStub {}

@Component({ template: 'elsewhere' })
class OtherStub {}

const admin: User = {
  id: 'admin-1',
  email: 'root@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  role: 'ADMIN',
  experienceLevel: 'ADVANCED',
  emailVerified: true,
  status: 'ACTIVE',
  mfaEnabled: true,
  createdAt: '2026-01-02T10:00:00.000Z',
  lastLoginAt: null,
  preferences: null,
};
const investor: User = { ...admin, id: 'u-2', role: 'INVESTOR' };

describe('accessRedirect', () => {
  const rule = { roles: ['ADMIN' as const], requireEmailVerified: true };

  it('sends signed-out visitors to sign-in with a safe returnTo', () => {
    expect(accessRedirect(null, '/admin/users?page=2#top', rule)).toBe('/login?returnTo=%2Fadmin%2Fusers%3Fpage%3D2');
  });

  it('rejects blocked statuses before checking the role', () => {
    expect(accessRedirect({ ...admin, status: 'SUSPENDED' }, '/admin', rule)).toBe('/unauthorized');
    expect(accessRedirect({ ...admin, status: 'DEACTIVATED' }, '/admin', rule)).toBe('/unauthorized');
  });

  it('asks unverified administrators to verify their e-mail', () => {
    expect(accessRedirect({ ...admin, emailVerified: false }, '/admin', rule)).toBe('/resend-verification');
  });

  it('sends other roles to /unauthorized and lets administrators in', () => {
    expect(accessRedirect(investor, '/admin', rule)).toBe('/unauthorized');
    expect(accessRedirect(admin, '/admin', rule)).toBeNull();
  });
});

describe('adminGuard', () => {
  let status: ReturnType<typeof signal<AuthStatus>>;
  let user: ReturnType<typeof signal<User | null>>;

  beforeEach(() => {
    status = signal<AuthStatus>('loading');
    user = signal<User | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'admin', component: AdminStub, canActivate: [adminGuard], canActivateChild: [adminGuard], children: [{ path: 'users', component: OtherStub }] },
          { path: 'unauthorized', component: OtherStub },
          { path: 'login', component: OtherStub },
          { path: 'resend-verification', component: OtherStub },
        ]),
        { provide: AuthService, useValue: { status, user } },
      ],
    });
  });

  async function navigate(url: string): Promise<{ url: string; text: string }> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url).catch(() => undefined);
    return { url: TestBed.inject(Router).url, text: harness.routeNativeElement?.textContent ?? '' };
  }

  it('defers to the in-page gate while the session is being restored', async () => {
    expect((await navigate('/admin')).url).toBe('/admin');
  });

  it('lets an administrator in', async () => {
    user.set(admin);
    status.set('authenticated');
    expect(await navigate('/admin/users')).toEqual({ url: '/admin/users', text: 'admin area' });
  });

  it('redirects an investor to /unauthorized without rendering the admin area', async () => {
    user.set(investor);
    status.set('authenticated');
    const result = await navigate('/admin/users');
    expect(result.url).toBe('/unauthorized');
    expect(result.text).not.toContain('admin area');
  });

  it('redirects a signed-out visitor to sign-in', async () => {
    status.set('unauthenticated');
    expect((await navigate('/admin/users')).url).toBe('/login?returnTo=%2Fadmin%2Fusers');
  });
});
