import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthApi } from '../core/api/auth-api';
import { describeApiError } from '../core/api/errors';
import { LEVEL_LABEL, LearningApi, type LearningProfile } from '../core/api/learning-api';
import { SessionsApi } from '../core/api/sessions-api';
import type { AuthSession, DashboardContext, User } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import {
  SAMPLE_CURRENCY,
  SAMPLE_DATA_NOTICE,
  sampleAllocation,
  sampleBenchmarkCurve,
  sampleEquityCurve,
  sampleMarketValue,
  samplePositions,
  sampleRisk,
  sampleSummary,
  sampleUnrealised,
  sampleWatchlist,
} from '../core/demo/sample-workspace';
import { describeDevice } from '../core/format/device';
import { formatDateTime, formatMoney, formatNumber, formatPercent } from '../core/format/finance';
import { sectorLabel } from '../trading/trading-format';
import { AccountStatusBadgeComponent } from '../shared/account-status-badge.component';
import { AllocationBarComponent, LineChartComponent, SparklineComponent, type ChartSeries } from '../shared/charts/charts.components';
import { IconComponent, type IconName } from '../shared/icon/icon.component';
import { HeadingActionsSlot, HeadingDescriptionSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';

export function greetingForHour(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Bonjour';
  if (hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

const MODULE_ROUTES: Record<string, { href: string; icon: IconName; blurb: string; label: string }> = {
  portfolio: { href: '/portfolios', icon: 'portfolio', label: 'Portefeuille virtuel', blurb: 'Portefeuilles virtuels, positions et performance.' },
  orders: { href: '/trading', icon: 'trading', label: 'Salle des ordres', blurb: 'Saisie d\'ordres simulés et historique d\'exécution.' },
  learning: { href: '/learn', icon: 'academy', label: 'Parcours d\'apprentissage', blurb: 'Missions du parcours, profil de compétences et histoires financières.' },
  ai: { href: '/ai', icon: 'ai', label: 'Analyses IA', blurb: 'Analyses des modèles avec confiance et limites.' },
  stress: { href: '/stress-testing', icon: 'bank', label: 'Tests de résistance bancaire', blurb: 'Scénarios de choc sur un bilan bancaire type.' },
  actuarial: { href: '/actuarial', icon: 'actuarial', label: 'Outils actuariels', blurb: 'Fréquence et sévérité des sinistres, perte agrégée et tarification.' },
  admin: { href: '/admin', icon: 'platform', label: 'Administration', blurb: 'Utilisateurs, rôles et journal d\'audit de sécurité.' },
};

const EXPERIENCE_LABEL: Record<User['experienceLevel'], string> = {
  BEGINNER: 'Débutant',
  INTERMEDIATE: 'Intermédiaire',
  ADVANCED: 'Avancé',
};

@Component({
  selector: 'span[mtr-pending-value]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'db-pendingValue' },
  template: `—<span class="sr-only">pas encore disponible</span>`,
})
export class PendingValueComponent {}

@Component({
  selector: 'mtr-readiness-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="readiness" heading="État du compte" description="Données en direct depuis votre compte.">
      <span mtrPanelBadge mtr-status-badge status="LIVE_INTEGRATED"></span>
      <div class="db-progress">
        <div class="db-progressTrack"><span [style.width.%]="(completed() / items().length) * 100"></span></div>
        <span class="num">{{ completed() }} sur {{ items().length }} terminé(s)</span>
      </div>
      <ul class="db-checklist">
        @for (item of items(); track item.title) {
          <li [attr.data-done]="item.done ? 'true' : 'false'">
            <span class="db-checkIcon"><svg mtrIcon [name]="item.done ? 'check' : 'alert'" [size]="14" /></span>
            <span class="db-checkText">
              <strong>{{ item.title }}<span class="sr-only">{{ item.done ? ' — fait' : ' — à faire' }}</span></strong>
              <span>{{ item.detail }}</span>
            </span>
            @if (!item.done) {
              <a [routerLink]="item.href" class="btn btn-secondary btn-sm">{{ item.action }}</a>
            }
          </li>
        }
      </ul>
    </section>
  `,
})
export class ReadinessPanelComponent {
  readonly user = input.required<User>();
  protected readonly items = computed(() => {
    const user = this.user();
    return [
      {
        done: user.emailVerified,
        title: 'Vérifiez votre courriel',
        detail: user.emailVerified ? `Vérifié · ${user.email}` : 'Requis pour débloquer toutes les capacités du compte.',
        href: '/resend-verification',
        action: 'Renvoyer le lien',
      },
      {
        done: user.mfaEnabled,
        title: 'Activez la vérification en deux étapes',
        detail: user.mfaEnabled ? 'Application d\'authentification activée.' : 'Protégez la connexion avec une application d\'authentification.',
        href: '/settings/security',
        action: 'Configurer',
      },
      {
        done: !!user.preferences,
        title: 'Préférences d\'affichage',
        detail: user.preferences ? `${user.preferences.preferredCurrency} · ${user.preferences.timezone}` : 'Choisissez votre devise et fuseau horaire.',
        href: '/settings/profile',
        action: 'Consulter',
      },
    ];
  });
  protected readonly completed = computed(() => this.items().filter((i) => i.done).length);
}

@Component({
  selector: 'mtr-sessions-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="devices" heading="Appareils connectés">
      <span mtrPanelBadge mtr-status-badge status="LIVE_INTEGRATED"></span>
      <a mtrPanelActions routerLink="/settings/sessions" class="btn btn-ghost btn-sm">Gérer</a>
      @if (error()) {
        <div mtr-empty-state tone="error" heading="Sessions indisponibles" [description]="error()"></div>
      } @else if (!sessions()) {
        <div mtr-panel-skeleton [rows]="3"></div>
      } @else if (sessions()!.length === 0) {
        <div mtr-empty-state icon="sessions" heading="Aucune session active"></div>
      } @else {
        <ul class="db-sessionList">
          @for (s of shown(); track s.id) {
            <li>
              <span class="db-sessionIcon"><svg mtrIcon name="sessions" [size]="16" /></span>
              <span class="db-sessionText">
                <strong [attr.title]="s.userAgent ?? null">{{ device(s) }}</strong>
                <span>Dernière activité {{ lastActive(s) }}</span>
              </span>
              @if (s.current) {
                <span class="badge badge-info">Cet appareil</span>
              }
            </li>
          }
          @if (sessions()!.length > 3) {
            <li class="db-sessionMore">+{{ sessions()!.length - 3 }} de plus · <a routerLink="/settings/sessions">tout voir</a></li>
          }
        </ul>
      }
    </section>
  `,
})
export class SessionsPanelComponent {
  readonly sessions = input<AuthSession[] | null>(null);
  readonly error = input<string | null>(null);
  readonly timeZone = input<string | undefined>(undefined);
  protected readonly shown = computed(() => (this.sessions() ?? []).slice(0, 3));

  protected device(session: AuthSession): string {
    return describeDevice(session.deviceLabel, session.userAgent);
  }

  protected lastActive(session: AuthSession): string {
    return formatDateTime(session.lastSeenAt, this.timeZone());
  }
}

@Component({
  selector: 'mtr-learning-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="learning" heading="Parcours d'apprentissage" description="Intelligence d'apprentissage — missions, compétences et recommandations.">
      <span mtrPanelBadge mtr-status-badge status="LIVE_INTEGRATED"></span>
      <a mtrPanelActions routerLink="/learn" class="btn btn-ghost btn-sm">Ouvrir</a>
      @if (error()) {
        <div mtr-empty-state tone="error" heading="Progression indisponible" [description]="error()"></div>
      } @else if (profile(); as p) {
        <div class="db-progress">
          <div class="db-progressTrack"><span [style.width.%]="progress()"></span></div>
          <span class="num">{{ missionsPassed() }} sur {{ playableMissions() }} missions réussies</span>
        </div>
        <ul class="db-sessionList">
          @if (active(); as a) {
            <li>
              <span class="db-sessionIcon"><svg mtrIcon name="play" [size]="16" /></span>
              <span class="db-sessionText">
                <strong>{{ a.missionTitle }}</strong>
                <span>En cours · jour {{ a.currentStep }}</span>
              </span>
              <a [routerLink]="'/learn/sessions/' + a.id" class="btn btn-primary btn-sm">Continuer</a>
            </li>
          }
          @for (r of recommendations(); track r.slug) {
            <li>
              <span class="db-sessionIcon"><svg mtrIcon name="academy" [size]="16" /></span>
              <span class="db-sessionText">
                <strong>{{ r.title }}</strong>
                <span>{{ levelLabel[r.level] }} · {{ r.reason }}</span>
              </span>
              <a [routerLink]="'/learn/missions/' + r.slug" class="btn btn-secondary btn-sm">Briefing</a>
            </li>
          }
          <li class="db-sessionMore">Niveau recommandé : {{ levelLabel[p.unlockedLevel] }} · <a routerLink="/stories">Voir une histoire financière</a></li>
        </ul>
      } @else {
        <div mtr-panel-skeleton [rows]="3"></div>
      }
    </section>
  `,
})
export class LearningPanelComponent {
  protected readonly profile = signal<LearningProfile | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly levelLabel = LEVEL_LABEL;
  protected readonly active = computed(() => this.profile()?.activeSessions.find((s) => s.kind === 'MISSION') ?? null);
  protected readonly missionsPassed = computed(() => this.profile()?.stats.missionsPassed ?? 0);
  protected readonly playableMissions = computed(() => this.profile()?.stats.playableMissions ?? 0);
  protected readonly progress = computed(() => (this.playableMissions() ? (this.missionsPassed() / this.playableMissions()) * 100 : 0));
  protected readonly recommendations = computed(() => (this.profile()?.recommendations ?? []).slice(0, this.active() ? 1 : 2));

  constructor() {
    let destroyed = false;
    inject(DestroyRef).onDestroy(() => (destroyed = true));
    inject(LearningApi)
      .profile()
      .then((p) => !destroyed && this.profile.set(p))
      .catch((err) => !destroyed && this.error.set(describeApiError(err, 'Impossible de charger votre progression d\'apprentissage.')));
  }
}

@Component({
  selector: 'mtr-modules-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, IconComponent, ...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section
      mtr-panel
      panelId="modules"
      heading="Modules de la station de travail"
      description="La disponibilité vient de la plateforme. Les modules en aperçu ouvrent leur écran conçu et expliquent ce qui est en attente."
    >
      @if (error()) {
        <div mtr-empty-state tone="error" heading="Modules indisponibles" [description]="error()"></div>
      } @else if (!context()) {
        <div mtr-panel-skeleton [rows]="4"></div>
      } @else {
        <ul class="db-modules">
          @for (mod of modules(); track mod.id) {
            <li>
              @if (mod.permitted && mod.route) {
                <a [routerLink]="mod.route.href" class="db-module"><ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ $implicit: mod }" /></a>
              } @else {
                <div class="db-module" aria-disabled="true" title="Votre rôle n'inclut pas ce module."><ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ $implicit: mod }" /></div>
              }
            </li>
          }
        </ul>
      }
    </section>
    <ng-template #body let-mod>
      <span class="db-moduleIcon"><svg mtrIcon [name]="mod.route?.icon ?? 'overview'" [size]="18" /></span>
      <span class="db-moduleText">
        <strong>{{ mod.label }}</strong>
        <span>{{ mod.route?.blurb ?? 'Détails du module bientôt disponibles.' }}</span>
      </span>
      @if (mod.permitted) {
        <span mtr-status-badge [status]="mod.available ? 'LIVE_INTEGRATED' : 'DESIGNED_PENDING_BACKEND'"></span>
      } @else {
        <span class="badge badge-muted"><svg mtrIcon name="lock" [size]="12" /> Non autorisé</span>
      }
    </ng-template>
  `,
})
export class ModulesPanelComponent {
  readonly context = input<DashboardContext | null>(null);
  readonly error = input<string | null>(null);
  readonly user = input.required<User>();
  protected readonly modules = computed(() =>
    (this.context()?.modules.filter((m) => m.id !== 'admin' || this.user().role === 'ADMIN') ?? []).map((m) => {
      const route = MODULE_ROUTES[m.id] ?? null;
      return {
        ...m,
        label: route?.label ?? m.label,
        route,
      };
    }),
  );
}

/** /dashboard: apps/web/src/app/dashboard/page.tsx */
@Component({
  selector: 'mtr-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IconComponent,
    PageHeadingComponent,
    HeadingActionsSlot,
    HeadingDescriptionSlot,
    ...WORKSPACE_PRIMITIVES,
    AccountStatusBadgeComponent,
    LineChartComponent,
    SparklineComponent,
    AllocationBarComponent,
    PendingValueComponent,
    ReadinessPanelComponent,
    SessionsPanelComponent,
    LearningPanelComponent,
    ModulesPanelComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './dashboard.page.html',
})
export class DashboardPage {
  private readonly auth = inject(AuthService);
  private readonly authApi = inject(AuthApi);
  private readonly sessionsApi = inject(SessionsApi);

  protected readonly user = this.auth.user;
  protected readonly context = signal<DashboardContext | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly sessions = signal<AuthSession[] | null>(null);
  protected readonly sessionsError = signal<string | null>(null);
  protected readonly sample = signal(false);

  protected readonly greeting = greetingForHour();
  protected readonly experienceLabel = EXPERIENCE_LABEL;
  protected readonly summary = sampleSummary();
  protected readonly risk = sampleRisk;
  protected readonly watchlist = sampleWatchlist;
  protected readonly allocation = sampleAllocation;
  protected readonly positions = samplePositions.map((p) => ({
    ...p,
    marketValue: formatMoney(sampleMarketValue(p), SAMPLE_CURRENCY),
    unrealised: sampleUnrealised(p),
  }));
  protected readonly currency = SAMPLE_CURRENCY;
  protected readonly formatNumber = formatNumber;
  protected readonly sectorLabel = sectorLabel;
  protected readonly equity = formatMoney(this.summary.equity, SAMPLE_CURRENCY);
  protected readonly varValue = formatPercent(sampleRisk.var95);
  protected readonly varHint = `Volatilité ${formatPercent(sampleRisk.annualVolatility, { digits: 1 })} · exemple`;
  protected readonly varVolatility = formatPercent(sampleRisk.annualVolatility, { digits: 1 });
  protected readonly varDrawdown = formatPercent(sampleRisk.maxDrawdown, { digits: 1 });
  protected readonly performanceSeries: ChartSeries[] = [
    { label: 'Portefeuille d\'exemple', values: sampleEquityCurve.map((p) => p.value), tone: 'brand', area: true },
    { label: 'Indice de référence', values: sampleBenchmarkCurve.map((p) => p.value), tone: 'muted', dashed: true },
  ];
  protected readonly performanceSummary = `Données d'exemple. Le portefeuille fictif passe de ${formatMoney(sampleEquityCurve[0].value, SAMPLE_CURRENCY)} à ${formatMoney(this.summary.equity, SAMPLE_CURRENCY)} sur 64 séances, devant un indice de référence fictif.`;
  protected readonly performanceAxis = (v: number) => formatMoney(v, SAMPLE_CURRENCY, { compact: true });
  protected readonly sessionLabels: [string, string] = ['Séance 1', 'Séance 64'];

  protected readonly contextualInsights = computed(() => {
    const ctx = this.context();
    if (!ctx) return [];
    const out: { icon: IconName; title: string; detail: string; href?: string; action?: string }[] = [];
    if (ctx.experienceLevelNotice) {
      out.push({
        icon: 'academy',
        title: 'Niveau d\'expérience',
        detail:
          'Le niveau d\'expérience adapte uniquement le contenu pédagogique. Ce n\'est ni une évaluation d\'adéquation à l\'investissement, ni une certification de trading.',
        href: '/learn',
        action: "Ouvrir le parcours d'apprentissage",
      });
    }
    for (const mod of ctx.modules.filter((m) => m.permitted && !m.available).slice(0, 2)) {
      const route = MODULE_ROUTES[mod.id];
      out.push({
        icon: route?.icon ?? 'overview',
        title: mod.label,
        detail: 'Écran conçu — le moteur de ce module n\'est pas encore connecté.',
        href: route?.href,
        action: route ? 'Aperçu' : undefined,
      });
    }
    if (ctx.requiredActions.includes('ENROLL_MFA_FOR_ADMIN')) {
      out.push({
        icon: 'lock',
        title: 'Sécurité administrateur',
        detail: 'Activez la vérification en deux étapes pour déverrouiller les outils d\'administration.',
        href: '/settings/security',
        action: 'Configurer',
      });
    }
    return out;
  });

  protected readonly readinessPct = computed(() => {
    const user = this.user();
    if (!user) return 0;
    const done = [user.emailVerified, user.mfaEnabled, !!user.preferences].filter(Boolean).length;
    return Math.round((done / 3) * 100);
  });

  protected readonly timeZone = computed(() => this.user()?.preferences?.timezone);
  protected readonly sampleNotice = computed(() => {
    const preferred = this.user()?.preferences?.preferredCurrency;
    const amounts =
      preferred && preferred !== SAMPLE_CURRENCY
        ? `Les montants sont en dinars tunisiens (DT), devise du marché simulé. Ils ne sont pas convertis dans votre devise d'affichage (${preferred}).`
        : 'Les montants sont en dinars tunisiens (DT), devise du marché simulé.';
    return `${SAMPLE_DATA_NOTICE} ${amounts}`;
  });
  protected readonly adminMfaRequired = computed(() => !!this.context()?.requiredActions.includes('ENROLL_MFA_FOR_ADMIN'));
  private readonly contextKey = computed(() => `${this.user()?.role}|${this.user()?.mfaEnabled}`);

  constructor() {
    effect((onCleanup) => {
      this.contextKey();
      let cancelled = false;
      onCleanup(() => (cancelled = true));
      untracked(() =>
        this.authApi
          .fetchDashboardContext()
          .then((ctx) => !cancelled && this.context.set(ctx))
          .catch((err) => !cancelled && this.error.set(describeApiError(err, 'Impossible de charger votre espace de travail.'))),
      );
    });

    let destroyed = false;
    inject(DestroyRef).onDestroy(() => (destroyed = true));
    this.sessionsApi
      .listSessions()
      .then((list) => !destroyed && this.sessions.set(list))
      .catch((err) => !destroyed && this.sessionsError.set(describeApiError(err, 'Impossible de charger vos sessions.')));
  }
}
