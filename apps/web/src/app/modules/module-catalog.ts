import type { NavIcon } from '../core/navigation/workspace-nav';

/**
 * apps/web/src/lib/modules/moduleCatalog.ts: the designed layout, capabilities, concepts and proposed API contract of
 * each module whose engine is not connected yet. The sidebar entries (workspace-nav.ts) only carry href, label, icon
 * and status; everything below exists nowhere else.
 */

export type BlueprintKind = 'chart' | 'table' | 'form' | 'kpis' | 'list' | 'heatmap';

export interface BlueprintBlock {
  title: string;
  kind: BlueprintKind;
  /** Grid columns out of 3. */
  span: 1 | 2 | 3;
  note: string;
}

export interface ApiContract {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  purpose: string;
}

export interface ModuleDefinition {
  slug: string;
  title: string;
  group: string;
  icon: NavIcon;
  summary: string;
  capabilities: string[];
  blueprint: BlueprintBlock[];
  contracts: ApiContract[];
  concepts: { term: string; definition: string }[];
  safeguard?: string;
}

export const MODULES: Record<string, ModuleDefinition> = {
  markets: {
    slug: 'markets',
    title: 'Marchés',
    group: 'Espace de travail',
    icon: 'markets',
    summary: 'Parcourir les instruments simulés, suivre l\'évolution des prix et constituer des listes de suivi avant de trader.',
    capabilities: [
      'Recherche d\'instruments sur actions, obligations, devises et matières premières',
      'Graphique de prix avec plages sélectionnables et statistiques de séance',
      'Listes de suivi personnelles avec colonnes de variation et de tendance',
      'Statut du marché et horodatage des données sur chaque cotation',
    ],
    blueprint: [
      { title: 'Recherche d\'instruments', kind: 'form', span: 1, note: 'Symbole, nom ou classe d\'actifs' },
      { title: 'Graphique de prix', kind: 'chart', span: 2, note: 'OHLC / ligne avec sélecteur de plage' },
      { title: 'Liste de suivi', kind: 'table', span: 2, note: 'Dernier, variation, tendance, horodatage' },
      { title: 'Statistiques de séance', kind: 'kpis', span: 1, note: 'Ouverture, plus haut, plus bas, volume' },
    ],
    contracts: [
      { method: 'GET', path: '/markets/instruments', purpose: 'Catalogue d\'instruments interrogeable' },
      { method: 'GET', path: '/markets/instruments/:symbol/quotes', purpose: 'Dernière cotation simulée avec horodatage' },
      { method: 'GET', path: '/markets/instruments/:symbol/candles', purpose: 'Chandeliers historiques par plage' },
      { method: 'GET', path: '/watchlists', purpose: 'Listes de suivi utilisateur (CRUD)' },
    ],
    concepts: [
      { term: 'Écart bid / ask', definition: 'L\'écart entre le meilleur prix qu\'un acheteur accepte de payer et qu\'un vendeur accepte de recevoir ; un coût de transaction direct.' },
      { term: 'OHLC', definition: 'Prix d\'ouverture, plus haut, plus bas et de clôture pour une période — le socle d\'un graphique en chandeliers.' },
      { term: 'Liquidité', definition: 'Facilité avec laquelle un actif peut être échangé sans en déplacer le prix.' },
    ],
  },
  trading: {
    slug: 'trading',
    title: 'Salle des marchés',
    group: 'Espace de travail',
    icon: 'trading',
    summary: 'Passer des ordres simulés au marché et à cours limité sur un capital virtuel, et consulter chaque exécution.',
    capabilities: [
      'Ticket d\'ordre avec ordres au marché, à cours limité et stop',
      'Contrôle pré-négociation du pouvoir d\'achat, du coût estimé et des frais',
      'Carnet des ordres ouverts avec annulation et modification',
      'Historique d\'exécution avec prix de fill et slippage',
    ],
    blueprint: [
      { title: 'Ticket d\'ordre', kind: 'form', span: 1, note: 'Sens, type, quantité, cours limite' },
      { title: 'Prix et profondeur', kind: 'chart', span: 2, note: 'Graphique intraday et carnet d\'ordres simulé' },
      { title: 'Ordres ouverts', kind: 'table', span: 2, note: 'Statut, quantité exécutée, annulation' },
      { title: 'Pouvoir d\'achat', kind: 'kpis', span: 1, note: 'Liquidités, réservé, disponible' },
    ],
    contracts: [
      { method: 'POST', path: '/orders', purpose: 'Soumettre un ordre simulé (clé d\'idempotence obligatoire)' },
      { method: 'GET', path: '/orders', purpose: 'Ordres ouverts et historiques' },
      { method: 'DELETE', path: '/orders/:id', purpose: 'Annuler un ordre ouvert' },
      { method: 'GET', path: '/accounts/me/buying-power', purpose: 'Liquidités, capital réservé et disponible' },
    ],
    concepts: [
      { term: 'Ordre au marché', definition: 'Exécuté immédiatement au meilleur prix disponible ; le prix n\'est pas garanti.' },
      { term: 'Ordre à cours limité', definition: 'Exécuté uniquement au cours limite ou à un meilleur prix ; l\'exécution n\'est pas garantie.' },
      { term: 'Slippage', definition: 'Écart entre le prix attendu et le prix d\'exécution réel.' },
    ],
    safeguard: 'La soumission d\'ordres reste désactivée tant que le moteur d\'exécution simulé n\'est pas connecté. Aucun ordre n\'est jamais envoyé sur un marché réel.',
  },
  portfolios: {
    slug: 'portfolios',
    title: 'Portefeuilles',
    group: 'Espace de travail',
    icon: 'portfolio',
    summary: 'Créer des portefeuilles virtuels, suivre les positions et mesurer la performance par rapport à un benchmark.',
    capabilities: [
      'Plusieurs portefeuilles virtuels avec capital de départ',
      'Positions avec coût d\'acquisition, valeur de marché et P&L latent',
      'Performance versus benchmark avec rendements pondérés dans le temps',
      'Allocation par classe d\'actifs, secteur et devise',
    ],
    blueprint: [
      { title: 'Synthèse du portefeuille', kind: 'kpis', span: 3, note: 'Valeur, rendement, liquidités, P&L latent' },
      { title: 'Performance', kind: 'chart', span: 2, note: 'Courbe d\'équité vs benchmark' },
      { title: 'Allocation', kind: 'heatmap', span: 1, note: 'Poids par classe d\'actifs' },
      { title: 'Positions', kind: 'table', span: 3, note: 'Qté, prix moyen, dernier, P&L' },
    ],
    contracts: [
      { method: 'GET', path: '/portfolios', purpose: 'Portefeuilles de l\'utilisateur' },
      { method: 'POST', path: '/portfolios', purpose: 'Créer un portefeuille virtuel' },
      { method: 'GET', path: '/portfolios/:id/positions', purpose: 'Positions avec valorisation' },
      { method: 'GET', path: '/portfolios/:id/performance', purpose: 'Série de rendements et benchmark' },
    ],
    concepts: [
      { term: 'P&L latent', definition: 'Gain ou perte sur les positions encore détenues, mesuré au prix actuel.' },
      { term: 'Rendement pondéré dans le temps', definition: 'Performance qui neutralise l\'effet des dépôts et des retraits.' },
      { term: 'Diversification', definition: 'Répartir l\'exposition pour qu\'un seul actif n\'ait qu\'un impact limité sur l\'ensemble.' },
    ],
  },
  risk: {
    slug: 'risk',
    title: 'Analyse des risques',
    group: 'Espace de travail',
    icon: 'risk',
    summary: 'Mesurer combien un portefeuille simulé pourrait perdre et d\'où provient ce risque.',
    capabilities: [
      'Value at Risk et expected shortfall à 95 % (simulation historique)',
      'Volatilité, concentration et drawdown maximal',
      'Contribution au risque ES par position',
      'Corrélation moyenne par paires et scénarios de stress hypothétiques',
      'Exposition et impact sur les limites avant négociation (fill hypothétique)',
    ],
    blueprint: [
      { title: 'Synthèse des risques', kind: 'kpis', span: 3, note: 'VaR, ES, volatilité, drawdown' },
      { title: 'Équité et drawdown', kind: 'chart', span: 2, note: 'Historique du portefeuille' },
      { title: 'Contribution au risque', kind: 'list', span: 1, note: 'Parts de perte de queue' },
      { title: 'Stress et pré-négociation', kind: 'table', span: 3, note: 'Scénarios et impact des ordres' },
    ],
    contracts: [
      { method: 'GET', path: '/portfolios/:id/analytics', purpose: 'Analytique complète : risque, contributions, diversification et méthodologie' },
      { method: 'GET', path: '/portfolios/:id/history', purpose: 'Historique d\'équité pour les graphiques de drawdown' },
      { method: 'POST', path: '/portfolios/:id/risk/pretrade', purpose: 'Exposition actuelle vs proposée, liquidités, poids et limites' },
    ],
    concepts: [
      { term: 'Value at Risk (VaR)', definition: 'Niveau de perte qui ne devrait pas être dépassé avec un niveau de confiance donné sur un horizon donné.' },
      { term: 'Expected shortfall', definition: 'Perte moyenne dans les cas où la VaR est dépassée.' },
      { term: 'Drawdown maximal', definition: 'Plus forte baisse du sommet au creux de la valeur du portefeuille.' },
    ],
  },
  strategies: {
    slug: 'strategies',
    title: 'Stratégies et tests historiques',
    group: 'Recherche et IA',
    icon: 'strategy',
    summary: 'Définir des stratégies fondées sur des règles et les rejouer sur des scénarios historiques pour voir comment elles se seraient comportées.',
    capabilities: [
      'Constructeur de stratégie avec règles d\'entrée, de sortie et de dimensionnement',
      'Backtests sur des périodes sélectionnables avec coûts de transaction',
      'Courbe d\'équité, drawdown et liste des trades',
      'Comparaison côte à côte avec un benchmark',
    ],
    blueprint: [
      { title: 'Règles de stratégie', kind: 'form', span: 1, note: 'Signaux, dimensionnement, coûts' },
      { title: 'Courbe d\'équité du backtest', kind: 'chart', span: 2, note: 'Stratégie vs benchmark' },
      { title: 'Statistiques', kind: 'kpis', span: 1, note: 'CAGR, Sharpe, drawdown, taux de réussite' },
      { title: 'Liste des trades', kind: 'table', span: 2, note: 'Entrée, sortie, rendement par trade' },
    ],
    contracts: [
      { method: 'GET', path: '/strategies', purpose: 'Stratégies enregistrées' },
      { method: 'POST', path: '/backtests', purpose: 'Mettre en file un job de backtest' },
      { method: 'GET', path: '/backtests/:id', purpose: 'Statut du job et résultats' },
    ],
    concepts: [
      { term: 'Backtest', definition: 'Application d\'une stratégie à des données historiques pour estimer sa performance passée.' },
      { term: 'Surapprentissage', definition: 'Calibrer une stratégie trop étroitement sur le passé au point qu\'elle échoue sur de nouvelles données.' },
      { term: 'Ratio de Sharpe', definition: 'Rendement excédentaire par unité de volatilité.' },
    ],
    safeguard: 'Les performances simulées passées ne prédisent pas les résultats futurs.',
  },
  backtesting: {
    slug: 'backtesting',
    title: 'Tests historiques',
    group: 'Recherche et IA',
    icon: 'strategy',
    summary: 'Exécuter une stratégie enregistrée sur une fenêtre historique et inspecter chaque trade simulé.',
    capabilities: [
      'Choisir une stratégie, une période, un capital de départ et un modèle de coûts',
      'Jobs asynchrones avec progression et annulation',
      'Résultats avec courbe d\'équité, drawdown et liste des trades',
      'Rapport exportable',
    ],
    blueprint: [
      { title: 'Configuration de l\'exécution', kind: 'form', span: 1, note: 'Stratégie, période, capital, coûts' },
      { title: 'Équité et drawdown', kind: 'chart', span: 2, note: 'Deux séries empilées' },
      { title: 'Historique des jobs', kind: 'table', span: 3, note: 'Statut, durée, statistiques clés' },
    ],
    contracts: [
      { method: 'POST', path: '/backtests/run', purpose: 'Backtest historique synchrone sur des clôtures quotidiennes fictives' },
      { method: 'GET', path: '/market/instruments/:symbol/indicators', purpose: 'Superpositions SMA/EMA/RSI/MACD/Bollinger' },
    ],
    concepts: [
      { term: 'Biais de look-ahead', definition: 'Utiliser par inadvertance une information qui n\'aurait pas été disponible au moment concerné.' },
      { term: 'Coûts de transaction', definition: 'Frais et spreads qui réduisent les rendements réels, souvent ignorés dans les backtests naïfs.' },
      { term: 'Test hors échantillon', definition: 'Valider une stratégie sur des données qui n\'ont pas servi à sa conception.' },
    ],
    safeguard: 'Les performances simulées passées ne prédisent pas les résultats futurs.',
  },
  ai: {
    slug: 'ai',
    title: 'Insights IA',
    group: 'Recherche et IA',
    icon: 'ai',
    summary: 'Observations générées par un modèle sur des portefeuilles et marchés simulés, toujours avec niveau de confiance et limites.',
    capabilities: [
      'Observations de portefeuille telles que concentration ou dérive',
      'Synthèses de scénarios en langage clair',
      'Niveau de confiance, fenêtre de données et version du modèle sur chaque insight',
      'Lien vers l\'explication de chaque insight',
    ],
    blueprint: [
      { title: 'Flux d\'insights', kind: 'list', span: 2, note: 'Observation, confiance, horodatage' },
      { title: 'Fiche modèle', kind: 'kpis', span: 1, note: 'Version, fenêtre d\'entraînement, limites connues' },
      { title: 'Détail de l\'insight', kind: 'chart', span: 3, note: 'Données à l\'appui et lien d\'explication' },
    ],
    contracts: [
      { method: 'GET', path: '/ai/insights', purpose: 'Insights avec confiance et provenance' },
      { method: 'GET', path: '/ai/models/:id', purpose: 'Fiche modèle' },
    ],
    concepts: [
      { term: 'Confiance', definition: 'Degré auquel un modèle soutient une sortie — pas la probabilité qu\'elle soit correcte dans le monde réel.' },
      { term: 'Dérive du modèle', definition: 'Dégradation lorsque les données en production diffèrent de celles sur lesquelles le modèle a appris.' },
      { term: 'Humain dans la boucle', definition: 'Une personne examine et décide ; le modèle informe seulement.' },
    ],
    safeguard: 'Les insights IA sont éducatifs et ne constituent jamais un conseil en investissement. Aucun score IA n\'est affiché tant qu\'un vrai modèle n\'est pas connecté.',
  },
  explainability: {
    slug: 'explainability',
    title: 'IA explicable',
    group: 'Recherche et IA',
    icon: 'xai',
    summary: 'Voir quels entrants ont conduit une sortie de modèle et quelle est sa sensibilité aux changements.',
    capabilities: [
      'Attribution des variables pour une sortie individuelle',
      'Importance globale des variables pour un modèle',
      'Sensibilité what-if sur les entrants clés',
      'Synthèse en langage clair de l\'explication',
    ],
    blueprint: [
      { title: 'Cascade d\'attribution', kind: 'chart', span: 2, note: 'Contribution de chaque entrant' },
      { title: 'Synthèse de l\'explication', kind: 'list', span: 1, note: 'Principaux moteurs en mots' },
      { title: 'Importance globale', kind: 'heatmap', span: 3, note: 'Importance des variables par modèle' },
    ],
    contracts: [
      { method: 'GET', path: '/ai/insights/:id/explanation', purpose: 'Attribution locale pour une sortie' },
      { method: 'GET', path: '/ai/models/:id/importance', purpose: 'Importance globale des variables' },
    ],
    concepts: [
      { term: 'Attribution des variables', definition: 'Combien chaque entrant a poussé une prédiction spécifique vers le haut ou vers le bas.' },
      { term: 'Valeurs SHAP', definition: 'Méthode fondée sur la théorie des jeux qui répartit équitablement une prédiction entre les entrants.' },
      { term: 'Analyse de sensibilité', definition: 'Modifier un entrant pour voir de combien la sortie bouge.' },
    ],
  },
  'stress-testing': {
    slug: 'stress-testing',
    title: 'Tests de résistance bancaires',
    group: 'Recherche et IA',
    icon: 'bank',
    summary: 'Appliquer des chocs macroéconomiques à un bilan bancaire d\'exemple et suivre l\'effet sur les fonds propres.',
    capabilities: [
      'Bibliothèque de scénarios : choc de taux, dégradation du crédit, ruée sur la liquidité',
      'Amplitudes de choc personnalisées avec hypothèses transparentes',
      'Trajectoire des ratios de capital versus minima réglementaires',
      'Décomposition étape par étape des pertes',
    ],
    blueprint: [
      { title: 'Scénario', kind: 'form', span: 1, note: 'Taux, défauts, sorties de dépôts' },
      { title: 'Trajectoire du ratio de capital', kind: 'chart', span: 2, note: 'CET1 face au minimum' },
      { title: 'Décomposition des pertes', kind: 'table', span: 3, note: 'Par portefeuille et type de risque' },
    ],
    contracts: [
      { method: 'GET', path: '/stress/scenarios', purpose: 'Bibliothèque de scénarios' },
      { method: 'POST', path: '/stress/runs', purpose: 'Exécuter un scénario sur le bilan d\'exemple' },
      { method: 'GET', path: '/stress/runs/:id', purpose: 'Résultats et décomposition des pertes' },
    ],
    concepts: [
      { term: 'Ratio CET1', definition: 'Fonds propres de base divisés par les actifs pondérés des risques — principale mesure de solvabilité bancaire.' },
      { term: 'Actifs pondérés des risques', definition: 'Actifs pondérés selon leur risque pour les exigences de fonds propres.' },
      { term: 'Couverture de liquidité', definition: 'Capacité des actifs liquides à couvrir 30 jours de sorties stressées.' },
    ],
  },
  actuarial: {
    slug: 'actuarial',
    title: 'Laboratoire actuariel',
    group: 'Assurance',
    icon: 'actuarial',
    summary: 'Modéliser le risque d\'assurance non-vie : fréquence et coût des sinistres, perte agrégée et primes à partir d\'hypothèses transparentes et modifiables.',
    capabilities: [
      'Comptes de sinistres binomiaux et de Poisson',
      'Coûts de sinistres déterministes, gamma et log-normaux',
      'Distribution de perte agrégée avec VaR et TVaR',
      'Prime pure, technique et commerciale avec ratios et sensibilités',
    ],
    blueprint: [
      { title: 'Hypothèses', kind: 'form', span: 1, note: 'Fréquence, sévérité, frais, chargement' },
      { title: 'Perte agrégée', kind: 'chart', span: 2, note: 'Distribution du total des sinistres' },
      { title: 'Construction de la prime', kind: 'table', span: 3, note: 'De la prime pure à la prime commerciale' },
    ],
    contracts: [
      { method: 'GET', path: '/actuarial/presets', purpose: 'Portefeuilles d\'exemple fictifs' },
      { method: 'POST', path: '/actuarial/pricing/calculate', purpose: 'Calcul de prime' },
      { method: 'POST', path: '/actuarial/aggregate/analyze', purpose: 'Distribution de perte agrégée' },
    ],
    concepts: [
      { term: 'Fréquence des sinistres', definition: 'Nombre de sinistres produits par un portefeuille sur une période.' },
      { term: 'Prime pure', definition: 'Espérance des sinistres E[S] = E[N] × E[X], avant chargements, frais et marge.' },
      { term: 'Ratio combiné', definition: 'Sinistres plus frais divisés par la prime ; au-dessus de 100 % signifie une perte technique.' },
    ],
  },
  challenges: {
    slug: 'challenges',
    title: 'Défis',
    group: 'Apprentissage',
    icon: 'challenge',
    summary: 'Défis de trading simulé chronométrés avec des règles claires et un classement équitable.',
    capabilities: [
      'Règles du défi : capital, instruments, durée, limites de risque',
      'Classement en direct selon le rendement ajusté du risque',
      'Revue post-défi de vos décisions',
    ],
    blueprint: [
      { title: 'Défis actifs', kind: 'list', span: 2, note: 'Règles, début, fin, participants' },
      { title: 'Votre classement', kind: 'kpis', span: 1, note: 'Rang, rendement, score de risque' },
      { title: 'Classement', kind: 'table', span: 3, note: 'Classé par rendement ajusté du risque' },
    ],
    contracts: [
      { method: 'GET', path: '/challenges', purpose: 'Défis ouverts et passés' },
      { method: 'POST', path: '/challenges/:id/join', purpose: 'Rejoindre un défi' },
      { method: 'GET', path: '/challenges/:id/leaderboard', purpose: 'Classement' },
    ],
    concepts: [
      { term: 'Rendement ajusté du risque', definition: 'Rendement jugé au regard du risque pris pour l\'obtenir, afin que la chance liée à de gros paris compte moins.' },
      { term: 'Limites de position', definition: 'Plafonds d\'exposition qui recentrent la compétition sur les décisions, non sur le levier.' },
    ],
  },
};

/** Routes of apps/web that render ModulePreviewPage (apps/web/src/app/<slug>/page.tsx). */
export const PREVIEW_MODULE_ROUTES = ['ai', 'challenges', 'explainability', 'strategies', 'stress-testing'] as const;
