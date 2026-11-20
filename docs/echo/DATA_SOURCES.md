# ÉCHO — Sources de données (audit vérifié par SQL le 2026-11-20)

## Constat sur cette machine

| Base | Où | Contenu vérifié |
|---|---|---|
| `PIF_spring_test` | **absente** de cette machine | La seule instance PostgreSQL locale est le conteneur Docker `mtrs-postgres` (le port `[::1]:5432` est relayé par WSL vers ce même conteneur). Les identifiants `nasma:…` cités dans les scripts sont refusés. |
| `PIF` | **absente** de cette machine | — donc inchangée par construction. |
| `pif_test` (Docker) | base utilisée par `apps/api/.env` | 25 tables métier, **10 instruments fictifs** (CTB, MDX, OLV, SFX, TEK, ATL, GOV, TNDB, OILX, EURT), migrations appliquées jusqu'à `20261114090000_actuarial_reserving_runs`. Les migrations `market_data_warehouse`, `market_rooms`, `platform_admin_content`, `take_profit_order_type` **n'y sont pas** appliquées. |
| `pif_dev`, `mtrs`, `mtrs_test` | Docker | bases plus anciennes, non utilisées. |

Les chiffres rapportés par les sessions précédentes (≈ 945 471 barres, ≈ 1 186 instruments, 6 crises, 45 actualités Fed/SEC, CMF/BVMT dès 2018, Yahoo dès 2008) **n'ont pas pu être vérifiés ici** : l'entrepôt n'est pas présent sur cette machine. Ils restent documentés dans `docs/data/REAL_MARKET_DATA_INTEGRATION.md`.

## Conséquence pour ÉCHO

ÉCHO ne lit pas l'entrepôt directement : il passe par `MarketService` / `MarketDataWarehouseRepository`, qui testent `tablesPresent()`.

- Entrepôt présent (environnement `PIF_spring_test`) : instruments historiques avec `dataKind: HISTORICAL`, `freshness: LAST_AVAILABLE_SESSION_CLOSE`, couverture `from/to/bars/source`, épisodes de crise et séries bornées à l'épisode.
- Entrepôt absent (cette machine) : instruments fictifs du simulateur ; ÉCHO l'annonce (« instrument pédagogique fictif ») et répond `NO_DATA` aux questions de crise sans reconstruire de série.

## Provenance affichée

Chaque réponse expose `sources[].provenance` (copie de la provenance renvoyée par le service : `providerId`, `kind`, `description`), `dataAsOf` (la plus ancienne date d'observation utilisée), et pour chaque valeur sa source (« Portefeuilles », « RiskStudio.snapshot », « Fiche modèle », « Hypothèse de la question »…). Une source n'apparaît que si l'outil correspondant a été appelé (`toolsUsed`).

## Ce qu'ÉCHO persiste

Uniquement : préférences, conversations/messages, intentions saisies (+ snapshot de concentration), alertes. Positions, ordres, exécutions et cotations ne sont **jamais** dupliqués.
