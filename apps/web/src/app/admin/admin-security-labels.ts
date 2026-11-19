/** Libellés français pour les codes d'événements et résultats d'audit admin. */

const EVENT_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Connexion réussie',
  LOGIN_FAILURE: 'Échec de connexion',
  LOGOUT: 'Déconnexion',
  FORGOT_PASSWORD: 'Mot de passe oublié',
  RESET_PASSWORD: 'Réinitialisation du mot de passe',
  REGISTER: 'Inscription',
  EMAIL_VERIFIED: 'Courriel vérifié',
  RESEND_VERIFICATION: 'Renvoi de vérification',
  MFA_ENROLLED: 'Vérification en deux étapes activée',
  MFA_DISABLED: 'Vérification en deux étapes désactivée',
  MFA_CHALLENGE: 'Défi de vérification',
  PASSWORD_CHANGED: 'Mot de passe modifié',
  PROFILE_UPDATED: 'Profil mis à jour',
  SESSION_REVOKED: 'Session révoquée',
  ADMIN_USER_UPDATED: 'Compte administré',
  ADMIN_USER_SUSPENDED: 'Compte suspendu',
  ADMIN_USER_REACTIVATED: 'Compte réactivé',
  EMAIL_CHANGE_REQUESTED: 'Changement de courriel demandé',
  EMAIL_CHANGE_CONFIRMED: 'Changement de courriel confirmé',
};

const OUTCOME_LABELS: Record<string, string> = {
  SUCCESS: 'Succès',
  FAILURE: 'Échec',
  DENIED: 'Refusé',
  ERROR: 'Erreur',
};

export function labelSecurityEvent(eventType: string | null | undefined): string {
  if (!eventType) return '—';
  const known = EVENT_LABELS[eventType];
  if (known) return known;
  const spaced = eventType.replaceAll('_', ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function labelSecurityOutcome(outcome: string | null | undefined): string {
  if (!outcome) return '—';
  return OUTCOME_LABELS[outcome] ?? outcome;
}

export function formatSecurityEventLine(
  eventType: string,
  outcome: string,
  detail: string,
): string {
  return `${labelSecurityEvent(eventType)} · ${labelSecurityOutcome(outcome)} · ${detail}`;
}
