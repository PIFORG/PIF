/** UI strings for the French (fr) locale — user-visible copy only. */

const FR = {
  nav: {
    groupWorkspace: 'Espace de travail',
    groupResearch: 'Analyses',
    groupLearn: 'Apprentissage',
    groupInsurance: 'Assurance',
    groupAccount: 'Compte',
    groupAdmin: 'Administration',
    overview: "Vue d'ensemble",
    markets: 'Marchés financiers',
    tradingDesk: 'Salle des marchés',
    portfolios: 'Portefeuilles',
    riskAnalytics: 'Analyser les risques',
    backtesting: 'Tester une stratégie',
    strategies: 'Catalogue de stratégies',
    aiInsights: 'Prévisions de marché',
    bankStress: 'Simuler une crise bancaire',
    explainableAi: 'Comprendre les prévisions',
    marketQuest: 'Mon parcours',
    finStories: 'Histoires financières',
    challenges: 'Défis boursiers',
    actuarialLab: 'Assurance et actuariat',
    profile: 'Profil',
    security: 'Sécurité',
    sessions: 'Sessions',
    platform: 'Tableau de bord',
    users: 'Utilisateurs',
    audit: "Journal d'activité",
    settings: 'Paramètres',
    admin: 'Espace administration',
  },
  status: {
    live: 'Disponible',
    demo: 'Démo',
    preview: 'Aperçu',
    previewBackendPending: 'Aperçu · moteur en attente',
    on: 'Activée',
    off: 'Désactivée',
    active: 'Actif',
    pendingVerification: 'Vérification en attente',
    suspended: 'Suspendu',
    deactivated: 'Désactivé',
    pendingDeletion: 'Suppression en attente',
  },
  common: {
    signIn: 'Se connecter',
    signOut: 'Se déconnecter',
    createAccount: 'Créer un compte',
    loading: 'Chargement…',
    tryAgain: 'Réessayer',
    manage: 'Gérer',
    open: 'Ouvrir',
    cancel: 'Annuler',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    search: 'Rechercher',
    back: 'Retour',
    continue: 'Continuer',
    email: 'Courriel',
    password: 'Mot de passe',
    confirm: 'Confirmer',
    working: 'Traitement…',
    previous: 'Précédent',
    next: 'Suivant',
    clear: 'Effacer',
    view: 'Voir',
    any: 'Tous',
    never: 'Jamais',
    notAvailableYet: 'pas encore disponible',
    sampleData: "Données d'exemple",
    workspace: 'Espace de travail',
    research: 'Recherche',
    account: 'Compte',
    backToSignIn: 'Retour à la connexion',
    continueToSignIn: 'Continuer vers la connexion',
  },
  auth: {
    twoStepVerification: 'Vérification en deux étapes',
    forgotPassword: 'Mot de passe oublié ?',
    register: "S'inscrire",
    welcomeBack: 'Bon retour',
    accessDenied: 'Accès refusé',
  },
  settings: {
    title: 'Paramètres',
    description: 'Gérez votre profil, la sécurité de connexion et les appareils connectés à votre compte.',
    navAria: 'Paramètres',
  },
  admin: {
    title: 'Administration de la plateforme',
    description:
      'Supervision des comptes, gestion des rôles et journal de sécurité. Chaque action est enregistrée.',
    navAria: 'Administration',
  },
  dashboard: {
    goodMorning: 'Bonjour',
    goodAfternoon: 'Bon après-midi',
    goodEvening: 'Bonsoir',
    welcomeBack: 'Bon retour, ',
    administrator: 'Administrateur',
    investor: 'Investisseur',
    beginner: 'Débutant',
    intermediate: 'Intermédiaire',
    advanced: 'Avancé',
  },
  risk: {
    title: 'Analyser les risques',
    pageDescription:
      "Valeur à risque, concentration et chocs sur vos positions virtuelles. Chaque chiffre est calculé côté serveur à partir de l'historique simulé.",
  },
  backtesting: {
    title: 'Tester une stratégie',
    pageDescription:
      'Appliquez une stratégie de référence sur des clôtures fictives — calculées par le moteur, jamais inventées côté interface.',
  },
  learn: {
    eyebrow: 'Apprentissage',
    hubTitle: 'Mon parcours',
    hubDescription:
      'Apprenez en pratiquant dans une simulation de marché déterministe. Chaque mission est notée sur le risque, les décisions, le raisonnement et l’exécution — jamais sur le profit seul.',
    storiesTitle: 'Histoires financières',
    storiesDescription:
      'Un investisseur, un dilemme, deux trajectoires. Choisissez A ou B mentalement — puis observez les deux futurs.',
    backToHub: 'Retour à mon parcours',
  },
  actuarial: {
    eyebrow: 'Assurance',
    labTitle: 'Assurance et actuariat',
    labDescription:
      'Outils pour tarifer, simuler les pertes, estimer les provisions, mesurer le capital et comparer actifs et passifs.',
    pricingTitle: 'Calculer une prime',
    pricingDescription:
      'Réglez la fréquence et le coût des sinistres, puis construisez la prime à partir de l’espérance, du chargement de risque, des frais et de la marge.',
    monteCarloTitle: 'Simuler les pertes',
    monteCarloDescription:
      'Simulez de nombreuses périodes de sinistres, puis lisez la queue : quantiles, moyennes de queue et probabilités de déficit, chacune avec un intervalle de confiance.',
    reservingTitle: 'Estimer les provisions',
    reservingDescription:
      'Estimez les sinistres restant à payer à partir de triangles de développement : chain ladder, ratio de sinistralité attendu et Bornhuetter–Ferguson.',
    openPricing: 'Ouvrir le calcul de prime',
  },
  modules: {
    backToOverview: "Retour à la vue d'ensemble",
  },
  landing: {
    heroTitleAccent: 'sans le risque du monde réel.',
    tagline: 'Les marchés financiers, sans le risque du monde réel.',
  },
  validation: {
    emailInvalid: 'Saisissez une adresse courriel valide',
    passwordRequired: 'Le mot de passe est obligatoire',
    passwordMin: 'Le mot de passe doit contenir au moins 8 caractères',
    passwordMax: 'Le mot de passe est trop long',
    passwordLetter: 'Le mot de passe doit contenir une lettre',
    passwordNumber: 'Le mot de passe doit contenir un chiffre',
    passwordSymbol: 'Le mot de passe doit contenir un symbole',
    passwordsDiffer: 'Les mots de passe ne correspondent pas',
    passwordHint: 'Au moins 8 caractères, dont une lettre, un chiffre et un symbole.',
    mfaCode: 'Saisissez un code à 6 chiffres ou un code de récupération',
    mfaTotp: "Saisissez le code à 6 chiffres de l'application d'authentification",
    firstNameRequired: 'Le prénom est obligatoire',
    lastNameRequired: 'Le nom est obligatoire',
    currentPasswordRequired: 'Le mot de passe actuel est obligatoire',
    currencyCode: 'Choisissez un code devise à 3 lettres',
    timezone: 'Choisissez un fuseau horaire',
  },
} as const;

function resolve(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || !(p in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** Resolve a dot-separated key into a French UI string. */
export function t(key: string): string {
  return resolve(FR as unknown as Record<string, unknown>, key) ?? key;
}

export { FR };
