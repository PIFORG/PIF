import { ApiError } from './types';

/** Messages for codes where the raw server text is not enough to act on. */
const CODE_MESSAGES: Record<string, string> = {
  ADMIN_MFA_REQUIRED:
    'Les outils d\'administration nécessitent la vérification en deux étapes. Activez-la dans Paramètres → Sécurité, puis réessayez.',
  MFA_REQUIRED: 'Saisissez le code de votre application d\'authentification pour confirmer cette action.',
  MFA_SETUP_EXPIRED: 'La configuration de l\'authentificateur a expiré. Relancez la configuration pour obtenir un nouveau secret.',
  RATE_LIMITED: 'Trop de tentatives. Attendez quelques minutes avant de réessayer.',
  CSRF_REJECTED: 'La requête a été bloquée car son origine n\'a pas pu être vérifiée. Rechargez la page et réessayez.',
  CONCURRENT_UPDATE: 'Ce compte a été modifié en même temps par quelqu\'un d\'autre. Rechargez et réessayez.',
};

/**
 * One user-facing sentence (plus any field-level details) for an error thrown by the API
 * client. Server messages are kept unless a code needs clearer next-step guidance.
 */
export function describeApiError(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) {
    return err instanceof TypeError
      ? 'Le serveur est injoignable. Vérifiez votre connexion et réessayez.'
      : fallback;
  }
  const base = (err.code && CODE_MESSAGES[err.code]) || err.message || fallback;
  if (err.details?.length && err.code === 'VALIDATION_ERROR') {
    return `${base}: ${err.details.join('; ')}`;
  }
  return base;
}

export function hasErrorCode(err: unknown, ...codes: string[]): boolean {
  return err instanceof ApiError && !!err.code && codes.includes(err.code);
}
