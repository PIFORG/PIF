import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthApi } from '../../core/api/auth-api';
import { describeApiError } from '../../core/api/errors';
import type { ExperienceLevel } from '../../core/api/types';
import { AuthService } from '../../core/auth/auth.service';
import {
  CHART_THEMES,
  hasErrors,
  TRAINING_DIFFICULTIES,
  validateProfile,
  type FieldErrors,
  type ProfileValues,
} from '../../core/validation/validators';
import { AccountStatusBadgeComponent } from '../../shared/account-status-badge.component';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';

const THEME_LABELS: Record<(typeof CHART_THEMES)[number], string> = {
  trading_desk: 'Salle des marchés (par défaut)',
  light: 'Clair',
  dark: 'Sombre',
};

const DIFFICULTY_LABELS: Record<(typeof TRAINING_DIFFICULTIES)[number], string> = {
  adaptive: 'Adaptatif',
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

function supportedValues(key: 'currency' | 'timeZone', extra: string[]): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const values = intl.supportedValuesOf?.(key) ?? [];
  return Array.from(new Set([...extra, ...values])).sort();
}

function formatDate(value: string | null): string {
  if (!value) return 'Jamais';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

type TextField = 'firstName' | 'lastName' | 'experienceLevel' | 'preferredCurrency' | 'timezone' | 'chartTheme' | 'trainingDifficulty';
type CheckField = 'notifyEmailSecurity' | 'notifyMarketDigest' | 'reduceMotion' | 'highContrast';

@Component({
  selector: 'mtr-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AccountStatusBadgeComponent, FormErrorComponent, FormSuccessComponent],
  host: { style: 'display: contents' },
  templateUrl: './profile.page.html',
})
export class ProfilePage {
  private readonly auth = inject(AuthService);
  private readonly api = inject(AuthApi);

  protected readonly user = this.auth.user;
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly errors = signal<FieldErrors<keyof ProfileValues>>({});
  protected readonly form = signal<ProfileValues>({
    firstName: '',
    lastName: '',
    experienceLevel: 'BEGINNER',
    preferredCurrency: 'USD',
    timezone: 'UTC',
    chartTheme: 'trading_desk',
    trainingDifficulty: 'adaptive',
    notifyEmailSecurity: true,
    notifyMarketDigest: false,
    reduceMotion: false,
    highContrast: false,
  });
  private submitted = false;

  protected readonly chartThemes = CHART_THEMES;
  protected readonly themeLabels = THEME_LABELS;
  protected readonly difficulties = TRAINING_DIFFICULTIES;
  protected readonly difficultyLabels = DIFFICULTY_LABELS;

  private readonly currentCurrency = computed(() => this.user()?.preferences?.preferredCurrency ?? 'USD');
  private readonly currentTimeZone = computed(() => this.user()?.preferences?.timezone ?? 'UTC');
  // The browser's ICU lists may differ from the server's.
  protected readonly currencies = computed(() => supportedValues('currency', [this.currentCurrency()]));
  protected readonly timeZones = computed(() => supportedValues('timeZone', ['UTC', this.currentTimeZone()]));

  protected readonly memberSince = computed(() => formatDate(this.user()?.createdAt ?? null));
  protected readonly lastSignIn = computed(() => formatDate(this.user()?.lastLoginAt ?? null));

  constructor() {
    effect(() => {
      const user = this.user();
      if (!user) return;
      const prefs = user.preferences;
      this.form.set({
        firstName: user.firstName,
        lastName: user.lastName,
        experienceLevel: user.experienceLevel,
        preferredCurrency: prefs?.preferredCurrency ?? 'USD',
        timezone: prefs?.timezone ?? 'UTC',
        chartTheme: (CHART_THEMES as readonly string[]).includes(prefs?.chartTheme ?? '') ? prefs!.chartTheme : 'trading_desk',
        trainingDifficulty: (TRAINING_DIFFICULTIES as readonly string[]).includes(prefs?.trainingDifficulty ?? '')
          ? prefs!.trainingDifficulty
          : 'adaptive',
        notifyEmailSecurity: prefs?.notifyEmailSecurity ?? true,
        notifyMarketDigest: prefs?.notifyMarketDigest ?? false,
        reduceMotion: prefs?.reduceMotion ?? false,
        highContrast: prefs?.highContrast ?? false,
      });
      this.errors.set({});
      this.submitted = false;
    });
  }

  protected setText(field: TextField, value: string): void {
    this.form.update((f) => ({ ...f, [field]: value }));
    if (this.submitted) {
      const { errors } = validateProfile(this.form());
      this.errors.update((current) => ({ ...current, [field]: errors[field] }));
    }
  }

  protected setCheck(field: CheckField, value: boolean): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;
    this.submitted = true;
    const { values, errors } = validateProfile(this.form());
    this.errors.set(errors);
    if (hasErrors(errors)) return;

    this.error.set(null);
    this.success.set(null);
    this.submitting.set(true);
    try {
      await this.api.updateProfile({
        firstName: values.firstName,
        lastName: values.lastName,
        experienceLevel: values.experienceLevel as ExperienceLevel,
      });
      await this.api.updatePreferences({
        preferredCurrency: values.preferredCurrency.toUpperCase(),
        timezone: values.timezone,
        chartTheme: values.chartTheme,
        trainingDifficulty: values.trainingDifficulty,
        notifyEmailSecurity: values.notifyEmailSecurity,
        notifyMarketDigest: values.notifyMarketDigest,
        reduceMotion: values.reduceMotion,
        highContrast: values.highContrast,
      });
      await this.auth.refreshUser();
      this.success.set('Profil mis à jour.');
    } catch (err) {
      this.error.set(describeApiError(err, 'Impossible de mettre à jour le profil.'));
    } finally {
      this.submitting.set(false);
    }
  }
}
