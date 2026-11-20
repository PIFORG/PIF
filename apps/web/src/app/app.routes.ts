import type { Route, Routes, UrlSegment } from '@angular/router';
import { adminGuard } from './core/auth/guards';
import { MIGRATED_ROUTES, WORKSPACE_NAV } from './core/navigation/workspace-nav';
import { WorkspaceLayoutComponent } from './layout/workspace-layout.component';
import { PublicNotMigratedPage, WorkspaceNotMigratedPage } from './migration/not-migrated.pages';
import { PREVIEW_MODULE_ROUTES } from './modules/module-preview-routes';
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
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./auth/register/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'verify-email',
    loadComponent: () => import('./auth/verify-email/verify-email.page').then((m) => m.VerifyEmailPage),
  },
  {
    path: 'resend-verification',
    loadComponent: () =>
      import('./auth/resend-verification/resend-verification.page').then((m) => m.ResendVerificationPage),
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./auth/forgot-password/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./auth/reset-password/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'confirm-email-change',
    loadComponent: () =>
      import('./auth/confirm-email-change/confirm-email-change.page').then((m) => m.ConfirmEmailChangePage),
  },
  {
    path: 'unauthorized',
    loadComponent: () => import('./auth/unauthorized/unauthorized.page').then((m) => m.UnauthorizedPage),
  },
  { path: '', pathMatch: 'full', loadComponent: () => import('./marketing/landing.page').then((m) => m.LandingPage) },
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin-layout.component').then((m) => m.AdminLayoutComponent),
    canActivate: [adminGuard],
    canActivateChild: [adminGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./admin/overview/admin-overview.page').then((m) => m.AdminOverviewPage),
      },
      {
        path: 'platform',
        loadComponent: () => import('./admin/platform/admin-platform.page').then((m) => m.AdminPlatformPage),
      },
      {
        path: 'users',
        loadComponent: () => import('./admin/users/admin-users.page').then((m) => m.AdminUsersPage),
      },
      {
        path: 'users/:id',
        loadComponent: () => import('./admin/user-detail/admin-user-detail.page').then((m) => m.AdminUserDetailPage),
      },
      {
        path: 'audit',
        loadComponent: () => import('./admin/audit/admin-audit.page').then((m) => m.AdminAuditPage),
      },
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
      {
        path: 'strategies',
        loadComponent: () => import('./backtesting/strategies.page').then((m) => m.StrategiesPage),
      },
      { path: 'learn', loadComponent: () => import('./learning/learning-hub.page').then((m) => m.LearningHubPage) },
      {
        path: 'learn/missions/:slug',
        loadComponent: () => import('./learning/mission-briefing.page').then((m) => m.MissionBriefingPage),
      },
      {
        path: 'learn/sessions/:id',
        loadComponent: () => import('./learning/mission-player.page').then((m) => m.MissionPlayerPage),
      },
      {
        path: 'learn/sessions/:id/review',
        loadComponent: () => import('./learning/session-review.page').then((m) => m.SessionReviewPage),
      },
      { path: 'stories', loadComponent: () => import('./stories/story-feed.page').then((m) => m.StoryFeedPage) },
      {
        path: 'actuarial',
        loadComponent: () => import('./actuarial/actuarial-overview.page').then((m) => m.ActuarialOverviewPage),
      },
      {
        path: 'actuarial/pricing',
        loadComponent: () => import('./actuarial/pricing-studio.page').then((m) => m.PricingStudioPage),
      },
      {
        path: 'actuarial/monte-carlo',
        loadComponent: () => import('./actuarial/monte-carlo-lab.page').then((m) => m.MonteCarloLabPage),
      },
      {
        path: 'actuarial/reserving',
        loadComponent: () => import('./actuarial/reserving-studio.page').then((m) => m.ReservingStudioPage),
      },
      {
        path: 'actuarial/capital',
        loadComponent: () => import('./actuarial/capital-studio.page').then((m) => m.CapitalStudioPage),
      },
      {
        path: 'actuarial/alm',
        loadComponent: () => import('./actuarial/alm-studio.page').then((m) => m.AlmStudioPage),
      },
      {
        path: 'stress-testing',
        loadComponent: () => import('./stress/stress-testing.page').then((m) => m.StressTestingPage),
      },
      { path: 'ai', loadComponent: () => import('./ai/ai-lab.page').then((m) => m.AiLabPage) },
      {
        path: 'explainability',
        loadComponent: () => import('./ai/explainability.page').then((m) => m.ExplainabilityPage),
      },
      {
        path: 'challenges',
        loadComponent: () => import('./challenges/challenges.page').then((m) => m.ChallengesPage),
      },
      {
        path: 'rooms',
        loadComponent: () => import('./rooms/rooms.page').then((m) => m.RoomsPage),
      },
      {
        path: 'rooms/:id',
        loadComponent: () => import('./rooms/room-session.page').then((m) => m.RoomSessionPage),
      },
      ...PREVIEW_MODULE_ROUTES.map((slug: string) => ({
        path: slug,
        data: { module: slug },
        loadComponent: () => import('./modules/module-preview.page').then((m) => m.ModulePreviewPage),
      })),
      {
        path: 'settings',
        component: SettingsLayoutComponent,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'profile' },
          {
            path: 'profile',
            loadComponent: () => import('./settings/profile/profile.page').then((m) => m.ProfilePage),
          },
          {
            path: 'security',
            loadComponent: () => import('./settings/security/security.page').then((m) => m.SecurityPage),
          },
          {
            path: 'sessions',
            loadComponent: () => import('./settings/sessions/sessions.page').then((m) => m.SessionsPage),
          },
        ],
      },
      pendingWorkspace,
    ],
  },
  { path: '**', component: PublicNotMigratedPage },
];
