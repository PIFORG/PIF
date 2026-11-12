# PIF official requirements — implementer summary

**Source:** `docs/requirements/PIF_Cahier_des_Charges_2026-2027.pdf`  
**SHA256:** `CA583835D50F50DA27812E966A4C931CF82232488568FC745BB9CD8366B85459`  
**Document:** *Simulateur de Salle de Marché*, Équipe PIF, AY 2026–2027 (7 pages, French).  
**Note in PDF:** content may be adjusted and may welcome student-proposed expansions.

## What the product is

An interactive **trading-room simulator** for novices and professionals: practice trading/investing, analyse markets, manage virtual portfolios, evaluate risk, with **AI**, **bank stress testing**, **XAI**, and an **actuarial** module.

## Domains (official §)

| § | Domain | Wording tone |
| --- | --- | --- |
| 1–2 | Introduction & objectives | Shall / must (“devra”, “permettre”) |
| 3.1 | User interface / dashboard | Must |
| 3.2 | Trading, risk management, financial analysis (TA/FA, history, backtesting) | Must; examples for stops/TP/diversification |
| 3.3 | Learning (modules, exercises, scenarios, contests, quizzes, progress) | Must |
| 3.4 | AI (prediction, recommendations, trading agent, sentiment) | Must integrate AI; “pourra” on some techniques |
| 3.5 | AI bank stress testing (conventional & non-conventional) | Must |
| 3.6 | Explainable AI | Must |
| 3.7 | Actuarial module | Must |
| 4 | Security & confidentiality | Must |
| 5 | Administration | Must |
| Annex | Reference online simulators | Recommendation only |

## Asset classes named

Equities, bonds, commodities, FX (§2 objectives).

## Not the same as “migration complete”

Technology migration delivers the platform. Official academic completion still needs live Risk Studio, backtesting, technical analysis, AI/XAI/bank stress, contests/quizzes, richer admin, etc. See `REQUIREMENTS_TRACEABILITY_MATRIX.md`.

## This engineering phase focus

1. Market-data foundation (provenance, history, asset classes).  
2. Risk Analytics Studio (portfolio-connected).  
3. Backtesting baselines.  
4. Technical indicators.  
5. Roadmap only for AI / bank stress / XAI / actuarial capital–ALM.
