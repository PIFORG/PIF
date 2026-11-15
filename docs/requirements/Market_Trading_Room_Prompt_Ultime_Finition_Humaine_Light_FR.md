# MARKET TRADING ROOM — FINALISATION PREMIUM, DESIGN HUMAIN ET ACCEPTATION DÉFINITIVE
## FRANCISATION TOTALE · MODE CLAIR PRIORITAIRE · DESIGN FINTECH NATUREL · INTERACTIONS AU CURSEUR · CAPITAL ACTUARIEL · ALM · VALIDATION NAVIGATEUR
### DIRECTION ARTISTIQUE D’UN DIRECTEUR DE DESIGN FINTECH ET D’UN INGÉNIEUR FRONTEND PRINCIPAL — NE PAS RECOMMENCER LE PROJET

# 0. OBJECTIF

Le dernier rapport de Market Trading Room indique :

- 54 exigences recensées.
- 51 `TERMINE_VERIFIE`.
- 1 `PARTIEL` : `MTR-07-FR-001`.
- 1 `ABSENT` : `MTR-04O-ACT-003` — capital économique / ALM.
- 1 `FACULTATIF_NON_REALISE` : carnet d'ordres avancé.
- 304 tests Angular réussis.
- 3 910 tests Spring Boot réussis.
- 211 tests pédagogiques de référence réussis.
- Environ 38 routes vérifiées dans le navigateur.
- Base principale `PIF` préservée.
- Migrations nouvelles validées uniquement dans `PIF_spring_test`.

Ces résultats sont issus du dernier rapport : vérifie-les dans les fichiers de preuves avant de les réutiliser.

**TA MISSION EST DE FINIR CE QUI RESTE, SANS RÉGRESSER SUR LES FONCTIONNALITÉS DÉJÀ VALIDÉES.**

L'application doit atteindre le meilleur niveau de finition raisonnablement démontrable pour un projet d'ingénierie financière ESPRIT.

Ne produis pas un nouveau plan général.

**NOUVELLE DÉCISION DE DESIGN PRIORITAIRE : le MODE CLAIR (« light ») est l'expérience de référence et le mode affiché par défaut. Le mode sombre reste disponible et soigné, mais ne doit pas dicter visuellement le mode clair.**

**La plateforme ne doit présenter aucun des clichés visuels d'une interface générée automatiquement ou d'un modèle de conversation tel que Claude : aucun effet de gabarit standardisé, aucune surenchère graphique, aucun aspect artificiellement « futuriste ». Vise la sobriété experte d'un produit FinTech conçu manuellement par une équipe senior.**

**Le curseur doit rendre toutes les zones véritablement interactives immédiatement lisibles : survol, sélection, données de graphiques, tableaux et boutons, avec réactions fines et cohérentes. Ne pas appliquer d'effets inutiles aux éléments non interactifs.**

Travaille directement sur le projet.

# 1. PRIORITÉ ABSOLUE — FERMER MTR-07-FR-001

Il reste une exigence partielle liée à la francisation.

**OBJECTIF : AUCUN ANGLAIS INJUSTIFIÉ DANS L'EXPÉRIENCE UTILISATEUR.**

Le nom de la plateforme reste :

**Market Trading Room**

Les identifiants techniques internes, symboles boursiers, acronymes scientifiques établis et noms propres peuvent rester inchangés lorsque nécessaire.

## Auditer les textes réellement visibles

Examiner :

- Pages publiques.
- Authentification.
- Profil.
- Sécurité.
- Sessions.
- Administration.
- Marchés.
- Trading.
- Obligations.
- Devises.
- Matières premières.
- Portefeuilles.
- Tableau de bord.
- Risques.
- Backtesting.
- Analyse fondamentale.
- MarketQuest.
- Dix missions.
- Mentor.
- Machine à remonter le temps.
- FinStories.
- Actuariat.
- Intelligence artificielle.
- XAI.
- Banque.
- Défis.
- Actualités.
- Messages.
- Graphiques.
- Infobulles.
- Fenêtres de dialogue.
- Erreurs.
- Courriels.
- Exports.

Vérifier tous les états dynamiques après interaction.

## Corriger les libellés d'appareils

Le rapport indique encore :

`Chrome on Windows`

Afficher en français :

`Chrome sous Windows`

Créer un formatage centralisé des informations d'appareil.

Conserver les données brutes d'agent utilisateur pour les besoins techniques et les audits de sécurité.

Ne pas modifier les signatures de sessions.

Vérifier les navigateurs et systèmes d'exploitation courants ainsi que les valeurs inconnues.

## Contenus pédagogiques

Vérifier effectivement les dix missions.

Ne laisser aucune phrase anglaise dans :

- Briefings.
- Événements.
- Objectifs.
- Mentor.
- Recommandations.
- Évaluations.
- Résultats.
- Historique.
- Messages d'erreur.

Préserver les règles pédagogiques et la reproductibilité.

## Validation

Exécuter le parcours réel dans un navigateur.

Corriger les éventuels textes anglais trouvés.

Créer des tests de non-régression.

Marquer `MTR-07-FR-001` comme `TERMINE_VERIFIE` uniquement lorsque les preuves sont suffisantes.

# 2. VALIDATION EXACTE DES ROUTES

Le rapport mentionne :

`38+ / ~38`

Ce format est imprécis.

Je veux un inventaire exact des routes Angular actuelles.

Énumérer les routes réelles avec leurs paramètres et leurs rôles.

Identifier :

- Routes publiques.
- Routes INVESTOR.
- Routes ADMIN.
- Routes avec paramètres.
- Routes ajoutées récemment.
- Routes de redirection.
- Pages inconnues ou introuvables.

Ne pas compter arbitrairement plusieurs redirections comme autant de pages fonctionnelles.

Pour chaque famille de routes :

1. Ouvrir la page dans le navigateur.
2. Vérifier le rôle.
3. Vérifier les données.
4. Tester les principales interactions.
5. Vérifier les erreurs.
6. Vérifier la persistance.
7. Vérifier le français.
8. Inspecter le rendu **en mode clair prioritairement**, puis en mode sombre.
9. Tester le mobile et le comportement tactile.
10. Vérifier au pointeur les survols, sélections, info-bulles et graphiques interactifs.
11. Vérifier le focus clavier et les préférences de réduction du mouvement.
12. Enregistrer le résultat et les captures avant/après.

Utiliser :

- 375 px.
- 768 px.
- 1 440 px.

Tester les thèmes clair et sombre, **en commençant toujours par le mode clair**, y compris la persistance du choix après rechargement.

Vérifier en priorité les éléments réactifs au curseur (tableaux, graphiques, navigation, filtres, boutons) et l'équivalence clavier/tactile.

Préserver :

**Profil utilisateur dans la navbar, en haut à droite.**

**Administration dans la sidebar, uniquement pour ADMIN.**

Vérifier que les accès administratifs sont protégés par Spring Boot, pas uniquement par Angular.

Produire un résultat exact :

`X / Y familles de routes exécutées et validées`

Indiquer séparément les parcours fonctionnels réellement testés.

# 3. UI/UX — FINITION HUMAINE DE NIVEAU SENIOR (VOIR ÉGALEMENT LA SECTION 3 BIS)

L'interface actuelle fonctionne, mais plusieurs écrans nécessitent encore une finition approfondie.

**NE PAS SE LIMITER À CORRIGER LES COULEURS OU LES MARGES.**

Conserver l'identité :

- Bleu marine.
- Bleu roi.
- Blanc clair.
- **Thème clair premium : PRIORITAIRE ET PAR DÉFAUT**.
- Thème sombre premium : secondaire, conservé et intégralement testé.

Le résultat doit évoquer un véritable logiciel de recherche et de simulation financière institutionnelle.

## Tableau de bord

Créer un cockpit financier visuellement distinctif.

Vérifier :

- Hiérarchie.
- Données réelles ou simulées correctement identifiées.
- Valeurs.
- Variations.
- Graphiques.
- Portefeuille.
- Risque.
- Progression pédagogique.
- Navigation.

Aucune carte redondante ou vide.

## Salle des marchés

Préserver un poste de négociation professionnel :

- Instruments.
- Graphiques.
- Ticket d'ordre.
- Positions.
- Exécution.
- Risques.
- Historique.

Optimiser la lisibilité et l'interaction.

## Studio d'analyse

Améliorer :

- Tableau de risque.
- Graphiques de volatilité.
- Exposition.
- Concentration.
- Backtesting.
- Comparaison de stratégies.
- Analyse fondamentale.

Les visualisations doivent être cohérentes avec leurs véritables résultats financiers.

## MarketQuest

Finaliser l'immersion :

- Carte pédagogique.
- Missions.
- Progression.
- Événements.
- Mentor.
- Résultats.
- Revue.

Ne pas modifier la logique métier sans nécessité.

## FinStories

Conserver l'identité cinématographique verticale.

Optimiser :

- Typographie.
- Narration.
- Transitions.
- Contraste.
- Sous-titres.
- Responsive.
- Progression.

## Actuariat et banque

Offrir des interfaces scientifiques lisibles et professionnelles.

Éviter les tableaux surchargés et les graphiques génériques.

## Landing page

Corriger les dernières sections insuffisamment abouties.

Ne pas laisser « En développement » pour les fonctionnalités réellement opérationnelles.

Ne pas annoncer comme disponibles les fonctionnalités encore absentes.

## Contrôle qualité

Pour chaque écran majeur :

1. Capturer une image réelle.
2. Évaluer l'alignement.
3. Vérifier le contraste.
4. Vérifier la densité d'information.
5. Vérifier les interactions.
6. Vérifier les petits écrans.
7. Vérifier l'accessibilité.
8. Corriger les défauts.
9. Recapturer après correction.

Ne pas casser les comportements existants au profit du design.

**La section 3 BIS définit les règles détaillées et obligatoires de design humain, mode clair et survol au curseur. Il ne suffit pas de déclarer ces règles « respectées » : elles doivent être implémentées et vérifiées visuellement et fonctionnellement.**

# 3 BIS. DIRECTION ARTISTIQUE NON NÉGOCIABLE — MODE CLAIR, DESIGN HUMAIN, INTERACTIONS AU CURSEUR

## 3 BIS.1. POSITIONNEMENT VISUEL : UNE VRAIE FINTECH CONÇUE PAR DES SENIORS

Agis comme un **ingénieur frontend principal spécialisé Angular**, un **directeur artistique FinTech**, un **designer graphique senior**, un **spécialiste de l'ergonomie des applications financières** et un **expert de l'accessibilité**.

**Je veux un produit pensé, composé et peaufiné à la main, pas une démo générée par IA.** Ne cherche pas à tromper un détecteur d'IA : élimine concrètement les choix de composition qui rendent les interfaces génériques, artificielles ou peu crédibles.

Références de qualité, sans cloner aucune marque : précision d'une application d'investissement sérieuse, lisibilité d'un terminal financier moderne, sobriété d'un logiciel B2B premium, densité maîtrisée d'un outil d'analyste et élégance éditoriale d'un produit conçu par une équipe expérimentée.

L'expérience doit être :

- **Simple au premier regard**, même pour un débutant.
- **Riche et efficace à l'usage**, même pour un utilisateur avancé.
- **Naturelle**, sans mouvements ou décorations qui semblent gratuits.
- **Cohérente** entre les modules et les états d'interaction.
- **Crédible** grâce aux vraies données, aux libellés exacts et aux règles financières claires.
- **Très professionnelle**, sans donner l'impression d'un tableau de bord copié-collé.
- **100 % en français** à chaque endroit destiné aux utilisateurs, sous les exceptions prévues.

## 3 BIS.2. LE MODE CLAIR EST LE MODE DE RÉFÉRENCE ET LE MODE PAR DÉFAUT

**PRIORITÉ DE DESIGN : MODE CLAIR — PAS MODE SOMBRE.**

Le mode clair doit être conçu en premier, vérifié en premier et servir de référence au design system. Sur une installation ou une première visite sans préférence enregistrée, afficher le **mode clair par défaut**, sans écraser la préférence explicite précédemment choisie par un utilisateur.

Le mode sombre reste disponible et pleinement fonctionnel, mais **ne doit jamais être un simple négatif/inverseur automatique du mode clair**, ni l'inverse.

Pour le mode clair :

- Arrière-plan général **blanc cassé ou gris froid presque blanc**, subtil et naturel.
- Surfaces principales **blanches**, nettes, lisibles, différenciées par des séparations discrètes.
- Texte principal **bleu nuit très foncé**, contrasté et précis.
- Bleu roi utilisé pour les **actions, la sélection et les informations de marque**, jamais en aplats saturés omniprésents.
- Bleu marine utilisé pour structurer certaines régions de façon stratégique, pas pour assombrir toute la page.
- Bordures délicates, espaces réguliers, **ombre minimale et motivée**.
- Tableaux financiers parfaitement lisibles sans jouer artificiellement sur les contrastes.
- États positifs, négatifs et neutres lisibles indépendamment de la couleur.
- Aucune grande masse grise, aucune page éblouissante de blanc pur, aucun empilement de cartes sans hiérarchie.

**Palette indicative pour le mode clair** — adapte les tokens aux contrastes et au système existant, sans imposer aveuglément les valeurs :

| Usage | Couleur indicative |
| --- | --- |
| Fond de l'application | `#F7F9FC` |
| Surface de contenu | `#FFFFFF` |
| Surface secondaire | `#F1F5FA` |
| Texte principal | `#102038` |
| Texte secondaire | `#53657A` |
| Ligne et bordure | `#DEE6EF` |
| Accent principal bleu roi | `#2556F4` |
| Bleu marine institutionnel | `#102448` |
| Survol discret | `#EDF3FF` |
| Focus visible | `#397DFF` |

Ces valeurs sont des points de départ, pas une excuse pour ignorer WCAG ou le rendu réel. Préserver une excellente lisibilité du texte et des données.

Pour le mode sombre : conserver un thème marine professionnel, sobre et lisible avec ses propres tokens de surfaces, bordures, texte, graphique, focus et survol. Toutes les fonctionnalités et tous les écrans doivent fonctionner **dans les deux thèmes**.

**AUCUNE régression de thème lors du rechargement, de la navigation ou de l'ouverture d'une modale.** Conserver les choix utilisateur et éviter le scintillement du thème au chargement.

## 3 BIS.3. INTERDICTION DES SIGNATURES VISUELLES « IA / CLAUDE / TEMPLATE GÉNÉRIQUE »

Élimine les choix visuels suivants lorsqu'ils n'ont aucune nécessité produit :

- Dégradés violets/roses/bleus utilisés partout.
- Grandes formes floues et halos multicolores derrière les titres.
- « Glassmorphism », transparence excessive, flou de fond décoratif.
- Cartes identiques répétées avec une icône géante et deux lignes de texte.
- Coins démesurément arrondis sur chaque composant.
- Ombres prononcées et inutiles.
- Effets néon, particules, étoiles ou faisceaux lumineux.
- Titres grandiloquents, vagues ou publicitaires dans une interface de travail.
- Multiplication de badges décoratifs ou de pictogrammes qui ne portent aucune information.
- Espaces vides excessifs masquant le manque de contenu réel.
- Panneaux de type « chat IA » là où l'utilisateur attend un outil financier professionnel.
- Composants de bibliothèque assemblés sans composition ni hiérarchie.
- Animations répétées à chaque changement de page sans bénéfice.
- Graphiques artificiellement impressionnants mais illisibles ou non reliés aux calculs.
- Textes marketing standardisés, données inventées ou chiffres décoratifs.

**NE FAIS PAS L'INVERSE en produisant une interface pauvre ou vieillotte.** La simplicité recherchée est une simplicité d'expert : moins d'ornements, plus de précision, de qualité typographique et d'utilité.

## 3 BIS.4. DESIGN SYSTEM FINTECH DE NIVEAU SENIOR

Audite et rationalise les tokens et composants Angular existants au lieu de créer un deuxième système parallèle.

Exige :

- Grille cohérente, alignements au pixel, espacements réguliers (échelle 4/8 px ou équivalente).
- Hiérarchie claire des titres et de l'information ; pas de typographie spectaculaire sur chaque titre.
- Police lisible pour le texte ; chiffres tabulaires pour montants, taux, cotations et tableaux.
- Colonnes numériques alignées par la droite et largeurs adaptées.
- Unités, devises, décimales, variations et signes explicites.
- Formulaires sobres avec labels permanents, aide contextuelle et erreurs immédiatement compréhensibles.
- Priorité visuelle évidente : une action principale par tâche, puis des actions secondaires discrètes.
- Icônes cohérentes, fines, de même famille et taille.
- Tables compactes mais respirantes, entêtes fixes lorsque pertinent, tri et filtres fonctionnels.
- Graphiques à axes lisibles, échelles documentées, légendes accessibles et info-bulles précises.
- Densité adaptée au métier : poste de trading plus dense, pages pédagogiques plus guidées, administration plus structurée.
- Responsive réellement recomposé, et non simplement des colonnes écrasées les unes sous les autres.
- États de chargement, erreur, absence de données, succès, attente et accès refusé traités comme des écrans de première classe.
- Aucune information importante exprimée par la seule couleur.
- Conventions financières françaises correctes sur toutes les pages.

**Le design doit se lire comme une famille de produits cohérente, sans imposer la même grille de cartes à chaque module.**

## 3 BIS.5. CURSEUR ET SURVOL — CHAQUE ÉLÉMENT INTERACTIF RÉAGIT INTELLIGEMMENT

Je veux que l'utilisateur sente immédiatement ce qu'il peut manipuler grâce au **survol de la souris**. Le curseur doit mettre en valeur les éléments qu'il rencontre **lorsqu'ils sont interactifs**, sans effets tape-à-l'œil et sans transformer tout le site en animation.

Sur ordinateur avec pointeur :

1. **Boutons** : état au survol visible mais subtil (teinte, bordure, contraste ou micro-déplacement très léger si utile) ; pointeur adapté ; état pressé et état désactivé distincts.
2. **Navigation / sidebar / navbar** : survol de la ligne sur toute sa largeur, indicateur actif clair, transition propre, zones de clic généreuses ; un seul état de sélection principal.
3. **Cartes cliquables** : rétroaction au survol sur toute la surface, sans ombre massive ni faux bouton ; ne pas faire réagir les cartes non cliquables comme des boutons.
4. **Tableaux financiers** : mise en évidence discrète de la ligne ou cellule survolée, alignement conservé, icônes d'action révélées proprement, sélection claire, aucun saut de largeur.
5. **Graphiques de marché** : pointeur/croix de lecture, mise en évidence du point ou de la bougie active, ligne de référence si utile, date et valeur exactes dans l'info-bulle, légende et série associées mises en valeur.
6. **Légendes de séries** : survol focalisant la série concernée et atténuant légèrement les autres seulement si cela améliore vraiment la lecture.
7. **Segments de répartition / histogrammes** : évidence du segment ciblé et info-bulle précise, sans changer la géométrie du graphique.
8. **Tickets d'ordre** : activation claire des onglets Acheter/Vendre, types d'ordres et contrôles, aide contextuelle sur les champs financiers.
9. **Scénarios, missions et lignes de chronologie** : survol révélant l'action possible, sélection persistante et distinction entre disponible/verrouillé/terminé.
10. **Actions administratives** : survol précis, confirmation pour opérations sensibles et distinction claire des actions destructives.
11. **Infobulles** : délai raisonnable, positionnement intelligent, lisibles sur clavier et souris, jamais bloquantes pour les clics.
12. **Liens et champs** : état interactif cohérent, sous-lignage ou autre indice approprié pour les liens, focus clairement visible.

Cadence d'animation indicative : **120 à 200 ms** pour les transitions légères ; privilégier `opacity`, `color`, `border-color`, `background-color` et `transform` lorsqu'approprié, sans animation coûteuse de layout.

**RÈGLE CRITIQUE : PAS DE GROS HALO FLUORESCENT QUI SUIT LA SOURIS, PAS DE TRAÎNÉE, PAS DE CURSEUR GÉANT, PAS DE « SPOTLIGHT » GLOBAL, PAS D'EFFETS AU SURVOL SUR LE TEXTE PASSIF.** Ces gimmicks feraient justement ressembler le produit à une démonstration générée par IA.

Le curseur `pointer` ne doit être utilisé que lorsque l'action est réellement disponible ; utiliser les curseurs de saisie, redimensionnement ou graphique adaptés lorsqu'ils améliorent l'usage.

Prévoir l'équivalence **clavier / focus visible**, et pour mobile les états tactiles, pressés et sélectionnés — **ne jamais dépendre exclusivement du hover**.

Respecter `prefers-reduced-motion`. Sur écrans tactiles, ne pas conserver des états de survol bloqués.

**Chaque effet visuel doit informer l'utilisateur, jamais le distraire.**

## 3 BIS.6. COMPOSITION SPÉCIFIQUE PAR MODULE, PAS DE COPIER-COLLER VISUEL

Adapter le mode clair et les interactions de pointeur à chaque expérience réelle :

- **Accueil public** : composition éditoriale sobre, promesse concrète, capture du produit réel si utilisée, typographie professionnelle, CTA principal clair. Éviter les slogans artificiels et visuels de stock génériques.
- **Tableau de bord** : hiérarchie compacte et pensée : richesse des portefeuilles, courbe dominante, contexte marché, positions et actions réellement utiles ; pas d'assemblage de cartes identiques.
- **Marchés** : tableau lisible avec survol de lignes, instrument sélectionné, graphique réel, filtres et détails sans confusion.
- **Salle des marchés** : poste de travail dense à zones coordonnées ; graphique central avec suivi précis du curseur, ticket lisible, états d'ordres explicites, focus sur le passage d'ordre.
- **Portefeuilles** : tableau de positions, agrégations et répartitions ; survol aidant la comparaison des valeurs, pas de décoration.
- **Risques** : hiérarchie des métriques, analyses de concentration, VaR et scénarios avec hypothèses accessibles ; survol montrant les contributions.
- **Simulation rétrospective** : stratégies à comparer, paramètres lisibles, courbes interactives, journal et explications ; aucune courbe fictive.
- **MarketQuest** : carte de progression immersive mais propre, missions lisibles et états interactifs clairs ; pas d'effets de jeu excessifs.
- **Machine à remonter le temps** : chronologie précise, point de divergence mis en évidence au survol, comparaison claire des décisions.
- **FinStories** : lecteur vertical immersif et épuré, contrôles discrets, sous-titres contrastés, comportement tactile naturel.
- **Laboratoire actuariel** : formulaires quantitatifs élégants, triangles de développement lisibles, distributions et scénarios faciles à interpréter.
- **IA / XAI** : distinction visuelle entre entrée, résultat, confiance, méthode, contribution et limites ; pas d'interface de chatbot plaquée arbitrairement.
- **Tests de résistance bancaire** : composition sérieuse, réglages de chocs, tableaux comparatifs et courbes cohérentes ; aide au survol des métriques.
- **Défis et compétitions** : règles, statut, progression et classement compréhensibles ; éviter l'esthétique de jeu d'argent.
- **Administration** : densité professionnelle, hiérarchie des permissions, tableaux et formulaires réels, feedback sur chaque action sensible.
- **Profil / sécurité / sessions** : sobriété rassurante, formulaires simples ; noms d'appareils francisés, informations techniques disponibles sans bruit visuel.

## 3 BIS.7. MESURES VISUELLES ET INTERACTIVES OBLIGATOIRES

Pour chaque grande route ou famille d'écrans :

1. Démarrer l'application et **observer son état réel**.
2. Capturer une image **AVANT** modification en mode clair (desktop + mobile pour les écrans principaux).
3. Identifier les défauts mesurables : contraste, alignement, densité, structure, survol, focus, actions, écrans vides.
4. Modifier les composants et tokens existants de façon ciblée.
5. Capturer une image **APRÈS**, dans les mêmes conditions.
6. Vérifier que les interactions pointées par le curseur répondent réellement (bouton, ligne, graphique, nav, formulaire).
7. Contrôler le focus clavier, le mode tactile et la réduction des mouvements.
8. Contrôler les thèmes clair et sombre ; **mode clair d'abord**.
9. Tester au minimum 375, 768 et 1440 px et l'absence de débordement horizontal.
10. Vérifier le français de toutes les copies visibles, y compris info-bulles et états de survol.
11. Vérifier qu'aucun résultat métier ou montant n'a changé à cause de la refonte graphique.
12. Réparer ce qui échoue, puis recapturer et relancer les tests concernés.

Inclure un inventaire clair des composants communs : navigation, en-têtes, tableaux, graphiques, boutons, champs, filtres, onglets, menus, modales, cartes interactives, notifications et graphiques à info-bulle.

Mesurer les régressions de performance significatives (chargement, interactions, animations, rendu des graphiques). Ne pas installer une grosse bibliothèque d'animation pour obtenir un effet de survol.

Viser **WCAG 2.2 AA** lorsqu'applicable, en particulier contrastes, focus visible, utilisation clavier et zones d'interaction. Référence : https://www.w3.org/TR/WCAG22/

**Ne prétends pas avoir une UI/UX « 20/20 » sans captures avant/après, parcours réels et preuves de qualité.**

## 3 BIS.8. CRITÈRES DE REFUS — UI INACCEPTABLE

Ne considère PAS la finition validée si :

- Le mode clair ressemble à un thème sombre dont on a simplement inversé les couleurs.
- Le mode clair est froid, creux, disproportionné, artificiel ou trop chargé.
- Les pages ressemblent à des gabarits IA/Claude reproduits en série.
- Les composants ont des gros halos, des dégradés décoratifs ou des coins exagérés.
- Le survol ne donne aucun retour sur les contrôles interactifs.
- Les boutons non fonctionnels ressemblent à des actions disponibles.
- Les graphiques ne permettent pas d'inspecter clairement des données.
- Des éléments non interactifs réagissent comme des boutons.
- Le pointeur dissimule les valeurs financières ou les info-bulles.
- Le focus clavier est invisible ou le comportement mobile dépend du hover.
- Les montants sont mal alignés, tronqués ou arrondis sans justification.
- Les graphiques et tableaux rendent des chiffres inventés comme réels.
- Un écran important est resté en anglais ou partiellement traduit.
- L'amélioration visuelle a cassé les règles métier, l'authentification ou la navigation.
- Le rapport prétend avoir tout retouché sans références de fichiers, captures ou parcours exécutés.

**Signature de qualité attendue : on doit pouvoir reconnaître une vraie application financière construite avec discernement, par un frontend senior et un designer graphique FinTech — simple, précise, élégante et extrêmement naturelle.**

---

# 4. CAPITAL ÉCONOMIQUE — EXTENSION ACTUARIELLE SCIENTIFIQUE

L'exigence `MTR-04O-ACT-003` est actuellement absente.

Le capital économique constitue une extension pertinente pour améliorer la valeur académique du laboratoire actuariel.

Implémente-le seulement avec un modèle correct, documenté et vérifié.

Réutilise les distributions de pertes existantes.

## Fonctionnalités

- Choix d'un scénario actuariel.
- Distribution des pertes.
- Perte attendue.
- Mesure de risque extrême.
- Niveau de confiance.
- Horizon.
- Capital économique.
- Analyse de sensibilité.
- Comparaison de scénarios.
- Sauvegarde des résultats.

Une définition pédagogique possible est :

Capital économique = VaR des pertes − perte attendue.

La convention exacte doit être explicitement définie, et les cas particuliers correctement traités.

Distinguer :

- Prime.
- Charge attendue.
- Provision.
- Capital de risque.
- Solvabilité.

Ne pas confondre le capital économique avec une exigence réglementaire automatiquement satisfaite.

Tester les modèles sur des distributions connues.

# 5. GESTION ACTIF-PASSIF — ALM

Compléter l'extension ALM si son implémentation scientifique et technique peut être menée correctement.

Inclure :

- Portefeuille d'actifs.
- Engagements ou passifs.
- Flux de trésorerie.
- Dates.
- Échéances.
- Valeurs actualisées.
- Sensibilité aux taux.
- Duration.
- Écarts temporels.
- Écarts de liquidité.
- Scénarios.
- Comparaisons.

## Parcours utilisateur

1. Créer un scénario.
2. Définir les actifs.
3. Définir les passifs.
4. Configurer les hypothèses.
5. Exécuter la simulation.
6. Calculer les flux.
7. Évaluer les écarts.
8. Simuler un choc.
9. Comparer les résultats.
10. Sauvegarder.

Les formules doivent être mathématiquement cohérentes.

Les données doivent être pédagogiques ou réelles avec une provenance claire.

Ne pas afficher des calculs fictifs.

Ajouter des tests JUnit appropriés.

Ne pas présenter un prototype ALM comme un outil réglementaire complet.

# 6. CARNET D'ORDRES — EXTENSION FACULTATIVE

Le carnet d'ordres prix-temps constitue une fonctionnalité historique facultative.

Ne pas sacrifier la stabilité du trading existant pour l'intégrer.

Si les obligations principales, le français, le design et les tests sont terminés, évaluer la possibilité de l'ajouter proprement.

Si développé, il doit couvrir :

- Ordres acheteurs.
- Ordres vendeurs.
- Priorité prix-temps.
- Meilleures offres.
- Profondeur.
- Appariement.
- Exécutions partielles.
- Quantités résiduelles.
- Annulations.
- Concurrence.
- Conservation du solde et des positions.
- Tests déterministes.

Le moteur doit rester compatible avec l'architecture Spring Boot actuelle.

Si une intégration complète et sûre est impossible, ne pas introduire un carnet fictif.

Conserver cette extension dans une catégorie facultative justifiée.

# 7. PRÉSERVER LES MOTEURS SCIENTIFIQUES

Ne réécris pas inutilement :

- Trading.
- Portefeuilles.
- Risques.
- Backtesting.
- IA.
- XAI.
- Stress bancaire.
- MarketQuest.
- Machine à remonter le temps.
- FinStories.
- Tarification actuarielle.
- Monte-Carlo.
- Provisionnement.

Toute modification doit préserver les calculs déjà validés.

Conserver l'honnêteté des désignations :

- Modèle entraîné.
- Modèle statistique.
- Système à règles.
- Analyse lexicale.
- Simulation stochastique.

Ne pas transformer des modèles à règles en prétendue IA avancée sans justification.

# 8. TESTS COMPLETS APRÈS MODIFICATIONS

Les anciennes suites ont réussi selon le rapport :

- Angular : 304 tests.
- Spring Boot : 3 910 tests.
- Golden learning : 211 tests.

Ces résultats servent de référence, pas de garantie après les nouvelles modifications.

Après finalisation, ajouter des contrôles spécifiques de design :

- Mode clair par défaut lors d'une première visite sans préférence.
- Sauvegarde et application du choix clair/sombre après rechargement.
- Qualité du survol au pointeur pour les éléments interactifs.
- Absence de survol trompeur sur les éléments passifs.
- Focus clavier équivalent aux états de survol.
- Comportement tactile sans hover bloqué.
- Info-bulles et surlignage des données de graphiques.
- Captures comparables avant/après sur les écrans majeurs.
- Vérification du contraste et de l'absence de contenu rogné.

Après finalisation, relancer :

- Tous les tests Angular.
- Tous les tests Spring Boot.
- Tests PostgreSQL isolés.
- Tests financiers.
- Tests actuariels.
- Tests bancaires.
- Tests IA et XAI.
- Tests de sécurité.
- Tests pédagogiques.
- Tests navigateur.
- Lint.
- Typecheck.
- Build de production.

Vérifier le nombre exact de tests exécutés et les éventuels tests ignorés.

Corriger toute régression.

Ne pas affaiblir les assertions.

Ne pas inventer des résultats de tests.

# 9. PROTECTION DE POSTGRESQL

La base principale `PIF` reste protégée.

**NE JAMAIS Y APPLIQUER AUTOMATIQUEMENT LES MIGRATIONS.**

Toutes les modifications de schéma doivent être testées dans une base isolée autorisée.

Conserver :

- Comptes.
- Portefeuilles.
- Transactions.
- Missions.
- Sessions.
- Simulations.
- Résultats.

La migration take-profit et les évolutions nécessaires aux instruments doivent rester en attente de déploiement autorisé.

Ne pas supprimer les historiques Prisma pour une simple raison esthétique.

Aucun commit, push ou déploiement automatique.

# 10. VALIDATION ACADÉMIQUE FINALE

Relire les exigences du cahier PIF 2026–2027.

Relire les 27 sections du prompt maître.

Comparer chaque exigence avec :

- Le code.
- L'API.
- La base.
- L'interface.
- Les calculs.
- Les tests.
- Les résultats.
- Les preuves.

Vérifier la matrice actuelle de 54 exigences.

Ne pas modifier artificiellement les états pour produire 54/54.

Une extension facultative non implémentée n'empêche pas automatiquement de satisfaire le cahier officiel.

Inversement, une exigence obligatoire ne peut pas être considérée comme terminée sans preuve.

Préparer un parcours de soutenance démontrant réellement :

- Connexion.
- Tableau de bord.
- Marchés.
- Trading.
- Risques.
- Backtesting.
- MarketQuest.
- Machine à remonter le temps.
- FinStories.
- Actuariat.
- Intelligence artificielle.
- Stress bancaire.
- XAI.
- Administration.

Aucune démonstration ne doit dépendre de données sensibles ou de secrets exposés.

# 11. EXÉCUTION — ÉCONOMIE DES TOKENS

Ne recommence pas le projet.

Ne produis pas une nouvelle longue feuille de route.

Ne répète pas les anciens rapports.

Travaille directement.

Priorités :

1. Terminer la francisation.
2. Vérifier exactement toutes les routes.
3. Corriger en priorité la finition UI/UX **du MODE CLAIR**, son naturel, sa sobriété et toutes les interactions au curseur ; vérifier ensuite le mode sombre.
4. Implémenter et tester le capital économique.
5. Implémenter et tester l'ALM si réalisable correctement.
6. Examiner le carnet d'ordres facultatif.
7. Relancer les suites complètes.
8. Contre-auditer la matrice.
9. Mettre à jour la documentation de soutenance.

Utilise les services, les DTO et les composants existants.

Évite toute duplication.

Conserve des checkpoints compacts.

Si une tâche ne peut pas être terminée dans cette exécution, documente précisément sa situation et ne la déclare pas achevée.

# 12. RAPPORT FINAL — COURT, PRÉCIS ET PROUVÉ

Fournir :

1. Exigences terminées / 54.
2. État exact de `MTR-07-FR-001`.
3. État exact de `MTR-04O-ACT-003`.
4. État du carnet d'ordres facultatif.
5. Routes réellement testées / total exact.
6. Tests Angular.
7. Tests Spring Boot.
8. Tests actuariels.
9. Tests PostgreSQL.
10. Tests navigateur.
11. Francisation : fuites restantes.
12. UI/UX : écrans corrigés, captures avant/après, qualité du **mode clair par défaut**, qualité du mode sombre, interactions au curseur, focus clavier, comportement tactile et problèmes visuels restants.
13. État de `PIF`.
14. Migrations en attente.
15. Défauts critiques.
16. Verdict.

## VERDICT AUTORISÉ

**COMPLET EN ENVIRONNEMENT DE TEST — TOUTES LES EXIGENCES OFFICIELLES OBLIGATOIRES SONT IMPLÉMENTÉES ET VÉRIFIÉES.**

ou

**INCOMPLET — EXIGENCES ET VALIDATIONS RESTANTES IDENTIFIÉES.**

Préciser séparément les extensions facultatives.

Ne pas déclarer la mise en production autorisée.

# ORDRE FINAL

**TERMINE LE FRANÇAIS.**

**PRÉCISE ET VALIDE TOUTES LES ROUTES.**

**DONNE À MARKET TRADING ROOM UNE FINITION UI/UX DIGNE D'UN LOGICIEL FINANCIER PROFESSIONNEL.**

**AJOUTE UNE EXTENSION ACTUARIELLE SCIENTIFIQUEMENT VALIDE.**

**PRÉSERVE LE FONCTIONNEMENT EXISTANT.**

**RELANCE TOUS LES TESTS.**

**NE MODIFIE PAS `PIF`.**

**NE DÉCLARE AUCUNE FONCTIONNALITÉ TERMINÉE SANS PREUVE.**

**EXÉCUTE MAINTENANT SUR LE DÉPÔT ACTUEL.**