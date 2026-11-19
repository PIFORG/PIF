# Audit moteur de trading — carnet d’ordres

**Date :** 2026-11-19  
**Sources code :** `apps/api/.../trading/Engine.java`, `PortfoliosService.java`, `OrderRules.java`, `docs/trading/README.md`  
**Cahiers :** PIF 2026–2027 (officiel) · Simulateur 2023–2024 Hugues (historique, PDF non présent dans le dépôt)

---

## Verdict court

| Question | Réponse vérifiée |
| --- | --- |
| Existe-t-il un matching peer-to-peer (investisseur A vs B) ? | **Non** |
| Existe-t-il un carnet CLOB prix-temps multi-participants ? | **Non** — extension historique facultative |
| Comment un ordre s’exécute-t-il ? | Contre le **cours simulé** (`MarketQuote`) et la **profondeur de période** |
| Exécutions partielles ? | **Oui** (MARKET IOC + LIMIT marketable) |
| Vente à découvert ? | **Interdite** (contrôle `held` + ventes ouvertes) |
| STOP / TAKE_PROFIT ? | Ventes protectrices ; matching lazy sur périodes de cotation |

**Ne pas présenter le moteur actuel comme un carnet d’ordres historique complet.**

---

## 1. Modèle d’exécution actuel (vérifié)

### Prix

- Fournisseur `SimulatedMarketProvider` (`pif-simulated-v1`), univers fictif, devise TND.
- Cotation par période de **5 minutes** : mid, bid, ask, profondeur au meilleur prix.
- Déterministe : même `(symbole, instant)` → même quote.
- Provenance affichée côté API/UI : **simulé / fictionnel**, pas un feed boursier réel.

### Contrepartie

- Contrepartie **implicite** = liquidité de profondeur de la période de cotation.
- Pas d’ordres d’autres utilisateurs consommés comme contrepartie.
- Pas de participants fictifs distincts persistés comme book levels.

### Types d’ordres

| Type | Comportement |
| --- | --- |
| MARKET | IOC : fill au touch jusqu’à `depth − depthUsed`, reste **annulé** (pas de fill infini) |
| LIMIT | Marketable → fill immédiat plafonné ; sinon repose jusqu’au croisement |
| STOP | Vente seule ; trigger si bid ≤ stop ; puis vente au bid |
| TAKE_PROFIT | Vente seule ; trigger si bid ≥ trigger ; puis vente au bid |

### Appariement « working »

- `Engine.matchWorkingOrders` : pour chaque période depuis le dernier match, évalue les ordres ouverts **du portefeuille**, oldest-first.
- Déclenché **lazy** sous verrou `SELECT … FOR UPDATE` du portefeuille (`PortfoliosService`).
- Consommation de profondeur **par portefeuille et par période** (pas un carnet global partagé).

### Liquidités / positions

- Millimes entiers ; frais par classe d’actif ; cash réservé pour buys LIMIT ouverts.
- Positions via `Ledger` / `Booking` ; P&L réalisé sur ventes.
- Idempotence `clientOrderId` ; versions portefeuille / `quoteAsOf`.

---

## 2. Ce que le cahier 2023–2024 décrit (extension)

Rappel (spécification historique, **non** reformulée comme obligation 2026–2027) :

- Carnet d’achat / vente **par titre**
- Tri par prix, priorité temporelle à prix égal
- Rapprochement d’ordres compatibles entre participants
- Exécution partielle + conservation du reliquat
- Interdiction de vente à découvert
- Options (si supportées)

### Compatibilité avec l’existant

| Aspect | Compatible sans rupture ? | Commentaire |
| --- | --- | --- |
| Tables book levels + match peer | Possible **en extension isolée** | Ne doit pas remplacer le mode quote-driven officiel |
| Même ledger / frais / pré-trade | Oui si fills passent par `Booking` | Préserver millimes + invariants |
| Profondeur simulée actuelle | Conflit conceptuel | Deux liquidités distinctes : quote depth vs book |
| Migrations sur `PIF` | **Interdit sans autorisation** | Préparer harness uniquement |

### Décision d’intégration (session 19/11/2026)

1. **Conserver** le moteur quote-driven comme **mode officiel** du simulateur PIF 2026–2027.
2. Classer le CLOB peer comme **`EXTENSION_FACULTATIVE` / `FACULTATIF_NON_REALISE`** tant qu’il n’est pas livré et testé.
3. **Ne pas** fabriquer un faux carnet UI branché sur la profondeur scalaire.
4. Si livré plus tard : moteur d’appariement **isolé**, mode explicite, migrations isolées, tests de concurrence dédiés.

---

## 3. Écarts corrigés / restants (moteur)

| Élément | État | Preuve |
| --- | --- | --- |
| Validation submission TAKE_PROFIT (prix, sens, au-dessus du bid) | **Corrigé** 19/11/2026 dans `Engine.evaluateOrder` | `EngineTakeProfitValidationTest` |
| Trigger resting TAKE_PROFIT | Déjà conforme via `OrderRules` | `FinanceSpecTest` |
| Enum PG `TAKE_PROFIT` sur base principale `PIF` | **En attente d’autorisation** | `READINESS_POSTGRESQL_PIF.md` |
| CLOB peer prix-temps | Non livré | Matrice `MTR-04E-TRD-005` |
| Options négociables (historique) | Non moteur complet | `NON_APPLICABLE_JUSTIFIE` / hors périmètre courant |

---

## 4. Invariants à préserver

- Aucun fill > profondeur restante de période (mode officiel).
- Aucune vente > quantité détenue − ventes ouvertes.
- Aucune double exécution sous le verrou portefeuille.
- MARKET sans liquidité → rejet / annulation du reste, **pas** de fill inventé.
- Précision monétaire millimes.
- Pas de mutation de `PIF` sans ordre explicite.
