package com.pif.api.echo;

import java.util.Map;

/**
 * Curated pedagogical definitions (French). These are explanations of concepts, not market data, and each one
 * names how the concept is computed inside Market Trading Room so the user can find it in the product.
 */
final class EchoGlossary {

  record Entry(String title, String definition, String inProduct, String route) {}

  private EchoGlossary() {}

  static final Map<String, Entry> ENTRIES = Map.ofEntries(
      Map.entry("var", new Entry("Value at Risk (VaR 95 %)",
          "La VaR à 95 % est la perte qui, sur un horizon donné, ne devrait être dépassée que dans 5 % des cas "
              + "observés. Ce n'est pas une perte maximale : 5 % des journées historiques ont fait pire.",
          "Dans Risques, la VaR est historique : elle rejoue les rendements quotidiens observés des positions "
              + "détenues sur la fenêtre disponible (jusqu'à 250 séances).", "/risk")),
      Map.entry("es", new Entry("Expected Shortfall (ES 95 %)",
          "L'Expected Shortfall est la perte moyenne des pires 5 % des cas. Elle décrit la profondeur de la queue "
              + "de distribution, là où la VaR n'indique que son seuil.",
          "Calculée sur le même échantillon historique que la VaR dans Risques.", "/risk")),
      Map.entry("drawdown", new Entry("Drawdown maximal",
          "Le drawdown maximal est la plus forte baisse, en pourcentage, entre un plus haut et un plus bas "
              + "ultérieur de la valeur du portefeuille.",
          "Mesuré sur la courbe de capitaux propres reconstruite à partir du journal de trésorerie et des "
              + "exécutions.", "/portfolios")),
      Map.entry("volatilite", new Entry("Volatilité",
          "La volatilité est l'écart-type des rendements. Annualisée, elle est multipliée par √252 (séances par an). "
              + "Elle mesure l'amplitude des variations, pas leur direction.",
          "Calculée sur les rendements quotidiens des clôtures disponibles pour chaque instrument.", "/risk")),
      Map.entry("hhi", new Entry("Indice de Herfindahl (HHI) et positions effectives",
          "Le HHI est la somme des carrés des poids des positions. 1/HHI donne le nombre de positions « effectives » : "
              + "deux lignes de 50 % comptent pour 2, une ligne de 90 % et une de 10 % pour environ 1,2.",
          "Affiché dans Risques et dans le contrôle pré-trade (avant / après).", "/risk")),
      Map.entry("diversification", new Entry("Diversification",
          "Diversifier, c'est répartir le risque entre des actifs dont les rendements n'évoluent pas tous ensemble. "
              + "Ajouter une ligne fortement corrélée aux existantes diversifie peu.",
          "Risques affiche la matrice de corrélation et le ratio de diversification des positions détenues.",
          "/risk")),
      Map.entry("correlation", new Entry("Corrélation",
          "La corrélation (entre −1 et 1) mesure à quel point deux séries de rendements varient ensemble. "
              + "Une corrélation n'établit pas de lien de cause à effet.",
          "Calculée sur les rendements quotidiens communs des positions détenues.", "/risk")),
      Map.entry("spread", new Entry("Spread acheteur-vendeur",
          "Le spread est l'écart entre le prix vendeur (ask) et le prix acheteur (bid). Un achat se fait à l'ask, "
              + "une vente au bid : c'est un coût implicite de chaque aller-retour.",
          "Le simulateur facture le spread à l'exécution et l'affiche en points de base sur chaque cotation.",
          "/trading")),
      Map.entry("frais", new Entry("Frais de transaction",
          "Les frais sont une commission proportionnelle au montant, avec un minimum par ordre selon la classe "
              + "d'actif. De petits ordres répétés paient proportionnellement plus.",
          "Barème appliqué par le moteur d'ordres ; le montant estimé apparaît dans l'aperçu de l'ordre.",
          "/trading")),
      Map.entry("twr", new Entry("Rendement pondéré par le temps (TWR)",
          "Le TWR mesure la performance de la gestion en neutralisant les apports et retraits d'argent.",
          "Affiché dans Portefeuilles à partir des valorisations quotidiennes.", "/portfolios")),
      Map.entry("mwr", new Entry("Rendement pondéré par les flux (MWR)",
          "Le MWR (proche du TRI) tient compte du moment et de la taille des apports : il mesure le rendement "
              + "vécu par l'investisseur.",
          "Affiché dans Portefeuilles à côté du TWR.", "/portfolios")),
      Map.entry("stop", new Entry("Ordre stop",
          "Un ordre stop devient un ordre au marché lorsque le prix franchit un seuil. Il limite une perte sans "
              + "garantir le prix d'exécution.",
          "Disponible dans le ticket d'ordre du Trading.", "/trading")),
      Map.entry("limite", new Entry("Ordre à cours limité",
          "Un ordre limité fixe un prix maximal à l'achat ou minimal à la vente. Il peut ne jamais être exécuté.",
          "Disponible dans le ticket d'ordre ; un achat limité réserve les liquidités nécessaires.", "/trading")),
      Map.entry("take-profit", new Entry("Take-profit",
          "Un take-profit vend automatiquement quand le prix atteint un objectif de gain.",
          "Disponible dans le ticket d'ordre du Trading.", "/trading")),
      Map.entry("backtest", new Entry("Backtest",
          "Un backtest rejoue une stratégie sur des données passées. Un bon résultat passé ne garantit pas un bon "
              + "résultat futur (surapprentissage, changement de régime).",
          "Le module Backtesting exécute des stratégies sur l'historique sans information future.",
          "/backtesting")),
      Map.entry("cet1", new Entry("Ratio CET1",
          "Le ratio CET1 rapporte les fonds propres de meilleure qualité aux actifs pondérés par les risques. "
              + "Plus il baisse sous le stress, moins la banque peut absorber de pertes.",
          "Projeté à un an par le moteur de stress bancaire, avec décomposition de Shapley des chocs.", "/stress")),
      Map.entry("lcr", new Entry("Liquidity Coverage Ratio (LCR)",
          "Le LCR compare les actifs liquides de haute qualité aux sorties de trésorerie sur 30 jours de stress. "
              + "Il doit rester au-dessus de 100 %.",
          "Calculé dans le stress bancaire pour chaque banque fictive.", "/stress")),
      Map.entry("shapley", new Entry("Valeurs de Shapley",
          "La décomposition de Shapley répartit l'écart total entre les facteurs en moyennant leur contribution "
              + "sur toutes les combinaisons. Elle explique le calcul du modèle, pas une causalité économique.",
          "Utilisée dans le stress bancaire (exacte) et dans les explications des modèles IA.", "/stress")),
      Map.entry("prime-pure", new Entry("Prime pure",
          "La prime pure est le coût attendu des sinistres par contrat : fréquence attendue × coût moyen.",
          "Calculée dans Actuariat › Tarification à partir des hypothèses saisies.", "/actuarial/pricing")),
      Map.entry("ratio-combine", new Entry("Ratio combiné",
          "Le ratio combiné rapporte sinistres et frais à la prime. Au-dessus de 100 %, l'activité d'assurance perd "
              + "de l'argent avant revenus financiers.",
          "Affiché dans Actuariat › Tarification.", "/actuarial/pricing")),
      Map.entry("provisions", new Entry("Provisions techniques",
          "Les provisions représentent les sinistres survenus mais pas encore réglés. La méthode chain-ladder "
              + "les estime à partir du développement passé des triangles de paiements.",
          "Calculées dans Actuariat › Provisionnement.", "/actuarial")),
      Map.entry("capital-economique", new Entry("Capital économique",
          "Le capital économique est le montant nécessaire pour absorber une perte extrême à un niveau de "
              + "confiance donné (par exemple 99,5 % sur un an).",
          "Calculé dans Actuariat › Capital économique à partir de la distribution simulée des pertes.",
          "/actuarial")),
      Map.entry("liquidite", new Entry("Liquidité",
          "Un actif liquide se vend vite sans faire bouger son prix. Peu de profondeur ou un spread large signalent "
              + "une liquidité faible.",
          "La profondeur et le spread sont affichés sur chaque cotation du Trading.", "/trading")),
      Map.entry("concentration", new Entry("Concentration",
          "Un portefeuille concentré dépend fortement d'une ou de quelques lignes : une baisse de celles-ci pèse "
              + "lourdement sur l'ensemble.",
          "Mesurée par le poids de la plus grande ligne et le HHI ; chaque portefeuille a un plafond de poids par "
              + "ligne.", "/risk")));
}
