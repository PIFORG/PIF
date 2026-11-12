import type { Route, Routes, UrlSegment } from '@angular/router';
import { AdminLayoutComponent } from './admin/admin-layout.component';
import { AdminAuditPage } from './admin/audit/admin-audit.page';
import { AdminOverviewPage } from './admin/overview/admin-overview.page';
import { AdminUserDetailPage } from './admin/user-detail/admin-user-detail.page';
import { AdminUsersPage } from './admin/users/admin-users.page';
import { ConfirmEmailChangePage } from './auth/confirm-email-change/confirm-email-change.page';
import { ForgotPasswordPage } from './auth/forgot-password/forgot-password.page';
import { LoginPage } from './auth/login/login.page';
import { RegisterPage } from './auth/register/register.page';
import { ResendVerificationPage } from './auth/resend-verification/resend-verification.page';
import { ResetPasswordPage } from './auth/reset-password/reset-password.page';
import { UnauthorizedPage } from './auth/unauthorized/unauthorized.page';
import { VerifyEmailPage } from './auth/verify-email/verify-email.page';
import { adminGuard } from './core/auth/guards';
import { MIGRATED_ROUTES, WORKSPACE_NAV } from './core/navigation/workspace-nav';
import { WorkspaceLayoutComponent } from './layout/workspace-layout.component';
import { PublicNotMigratedPage, WorkspaceNotMigratedPage } from './migration/not-migrated.pages';
import { PREVIEW_MODULE_ROUTES } from './modules/module-catalog';
import { ProfilePage } from './settings/profile/profile.page';
import { SecurityPage } from './settings/security/security.page';
import { SessionsPage } from './settings/sessions/sessions.page';
import { SettingsLayoutComponent } from './settings/settings-layout.component';

/** Navigation destinations (and their sub-paths) that are still served only by apps/web. */
const PENDING_PREFIXES = WORKSPACE_NAV.flatMap((group) => group.items)
  .filter((item) => !MIGRATED_ROUTES.includes(item.href) && !item.href.startsWith('/settings/'))
  .flatMap((item) => [item.href, ...(item.match ?? [])]);

function pendingWorkspaceMatcher(segments: UrlSegment[]) {
  const path = '/' + segments.map((s) => s.path).join('/');
  const matched = PENDING_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return matched ? { consumed: segments } : null;
}

const pendingWorkspace: Route = { matcher: pendingWorkspaceMatcher, component: WorkspaceNotMigratedPage };

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  { path: 'register', component: RegisterPage },
  { path: 'verify-email', component: VerifyEmailPage },
  { path: 'resend-verification', component: ResendVerificationPage },
  { path: 'forgot-password', component: ForgotPasswordPage },
  { path: 'reset-password', component: ResetPasswordPage },
  { path: 'confirm-email-change', component: ConfirmEmailChangePage },
  { path: 'unauthorized', component: UnauthorizedPage },
  { path: '', pathMatch: 'full', loadComponent: () => import('./marketing/landing.page').then((m) => m.LandingPage) },
  {
    path: 'admin',
    component: AdminLayoutComponent,
    canActivate: [adminGuard],
    canActivateChild: [adminGuard],
    children: [
      { path: '', pathMatch: 'full', component: AdminOverviewPage },
      { path: 'users', component: AdminUsersPage },
      { path: 'users/:id', component: AdminUserDetailPage },
      { path: 'audit', component: AdminAuditPage },
    ],
  },
  {
    path: '',
    component: WorkspaceLayoutComponent,
    children: [
      { path: 'dashboard', loadComponent: () => import('./dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'markets', loadComponent: () => import('./trading/markets.page').then((m) => m.MarketsPage) },
      { path: 'trading', loadComponent: () => import('./trading/trading-desk.page').then((m) => m.TradingDeskPage) },
      { path: 'portfolios', loadComponent: () => import('./trading/portfolios.page').then((m) => m.PortfoliosPage) },
      { path: 'risk', loadComponent: () => import('./risk/risk-analytics.page').then((m) => m.RiskAnalyticsPage) },
      { path: 'backtesting', loadComponent: () => import('./backtesting/backtesting.page').then((m) => m.BacktestingPage) },
      { path: 'learn', loadComponent: () => import('./learning/learning-hub.page').then((m) => m.LearningHubPage) },
      { path: 'learn/missions/:slug', loadComponent: () => import('./learning/mission-briefing.page').then((m) => m.MissionBriefingPage) },
      { path: 'learn/sessions/:id', loadComponent: () => import('./learning/mission-player.page').then((m) => m.MissionPlayerPage) },
      { path: 'learn/sessions/:id/review', loadComponent: () => import('./learning/session-review.page').then((m) => m.SessionReviewPage) },
      { path: 'stories', loadComponent: () => import('./stories/story-feed.page').then((m) => m.StoryFeedPage) },
      { path: 'actuarial', loadComponent: () => import('./actuarial/actuarial-overview.page').then((m) => m.ActuarialOverviewPage) },
      { path: 'actuarial/pricing', loadComponent: () => import('./actuarial/pricing-studio.page').then((m) => m.PricingStudioPage) },
      { path: 'actuarial/monte-carlo', loadComponent: () => import('./actuarial/monte-carlo-lab.page').then((m) => m.MonteCarloLabPage) },
      { path: 'actuarial/reserving', loadComponent: () => import('./actuarial/reserving-studio.page').then((m) => m.ReservingStudioPage) },
      ...PREVIEW_MODULE_ROUTES.map((slug) => ({
        path: slug,
        data: { module: slug },
        loadComponent: () => import('./modules/module-preview.page').then((m) => m.ModulePreviewPage),
      })),
      {
        path: 'settings',
        component: SettingsLayoutComponent,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'profile' },
          { path: 'profile', component: ProfilePage },
          { path: 'security', component: SecurityPage },
          { path: 'sessions', component: SessionsPage },
        ],
      },
      pendingWorkspace,
    ],
  },
  { path: '**', component: PublicNotMigratedPage },
];
