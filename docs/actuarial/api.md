# Actuarial Lab: API (Phases 1 to 3)

**Basics:**

| Item | Value |
| --- | --- |
| Base path | `/api/actuarial` |
| Swagger tag | *Actuarial Lab* |
| Authentication | Bearer access token on every route (`401` without one) |
| Rate limit | 120 requests per minute per client; the compute and save endpoints allow 60; `POST /simulations` allows 12 |

**Request rules.** Requests are validated by the global `ValidationPipe`:

- Unknown fields are rejected with `400`. Clients therefore cannot submit their own results.
- Numbers must be finite.
- Decimal places are limited (for example, 6 for probabilities and 3 for amounts).

**Responses.** All amounts are in TND, rounded to the millime. Rates and probabilities are ratios (0.05 = 5%). Every calculation response carries:

```json
"provenance": { "kind": "ESTIMATED", "basis": "Model estimate from user-entered fictional assumptions; no observed claims data.", "modelVersion": "pif-actuarial-1.0.0", "currency": "TND" }
```

Monte Carlo results carry `"kind": "SIMULATED"`, the engine version `pif-actuarial-mc-1.0.0` and the seed in `basis` (section 5).

## 1. Endpoints

| Method | Path | Status | Purpose |
| --- | --- | --- | --- |
| GET | `/overview` | 200 | Reference portfolio priced by the server, your scenario count and the five most recent, your five most recent simulation runs, workspace statuses |
| GET | `/presets` | 200 | Three fictional example portfolios with their headline premium |
| POST | `/frequency/analyze` | 200 | Claim count analysis |
| POST | `/severity/analyze` | 200 | Claim cost analysis |
| POST | `/aggregate/analyze` | 200 | Aggregate loss: moments, distribution, VaR, TVaR, exceedance |
| POST | `/pricing/calculate` | 200 | Full premium calculation |
| GET | `/scenarios` | 200 | Your saved scenarios, newest first, with headline figures |
| POST | `/scenarios` | 201 | Save assumptions under a name. The server computes and stores the results |
| GET | `/scenarios/:id` | 200 | One of your scenarios with inputs and results |
| DELETE | `/scenarios/:id` | 204 | Delete one of your scenarios |
| POST | `/simulations` | 201 | Run a seeded Monte Carlo simulation and store its summarised results. Answers once the run is complete |
| GET | `/simulations` | 200 | Your stored runs, newest first, with headline figures |
| GET | `/simulations/:id` | 200 | One of your runs with its inputs and results |
| DELETE | `/simulations/:id` | 204 | Delete one of your runs |
| GET | `/reserving/examples` | 200 | Three fictional triangles with premiums and default assumptions, the input limits, the averages and the methods with their labels |
| POST | `/reserving/analyze` | 200 | Validate the triangles and compute factors, ultimates, case reserves, IBNR, unpaid, sensitivities and expected payments. Nothing is stored |
| POST | `/reserving/runs` | 201 | Store a labelled run: inputs as submitted, results recomputed by the server, model version, data checksum |
| GET | `/reserving/runs` | 200 | Your stored reserving runs, newest first, with headline figures |
| GET | `/reserving/runs/:id` | 200 | One of your reserving runs with inputs and results |
| DELETE | `/reserving/runs/:id` | 204 | Delete one of your reserving runs |

The compute endpoints use `POST` because they take a structured body. They have **no side effects** and are **not logged**.

`POST /simulations` is different: it stores the run. It responds only when the run has finished. There is no "running" state that could be read with partial or placeholder figures.

## 2. Request objects

### `frequency`

| Field | Type | Bounds | Notes |
| --- | --- | --- | --- |
| `family` | `BINOMIAL` \| `POISSON` | — | |
| `policies` | integer | 1 – 1,000,000 | |
| `years` | number | 0.25 – 5, 2 decimals | Cover period |
| `probability` | number | 0.0001 – 0.5 | **Required for BINOMIAL.** Annual claim probability per policy |
| `intensity` | number | 0.0001 – 2 | **Required for POISSON.** Expected claims per policy-year |

### `severity`

| Field | Type | Bounds | Notes |
| --- | --- | --- | --- |
| `family` | `DETERMINISTIC` \| `GAMMA` \| `LOGNORMAL` | — | `NORMAL` is rejected: claim costs cannot be negative |
| `mean` | number | 1 – 10,000,000 | **Arithmetic** mean cost of one claim (TND) |
| `cv` | number | 0.05 – 5 | **Required for GAMMA and LOGNORMAL.** sd / mean |

### Pricing body (`POST /pricing/calculate`, and `assumptions` in `POST /scenarios`)

| Field | Bounds | Notes |
| --- | --- | --- |
| `frequency` | see above | |
| `severity` | see above | Mean before inflation |
| `inflation.annualRate` | −0.05 – 0.30 | Claim-cost inflation |
| `inflation.years` | 0 – 10 | Years of trend to the cover period |
| `expenses.fixed` | 0 – 100,000,000 | For the whole portfolio |
| `expenses.perPolicy` | 0 – 100,000 | |
| `expenses.variableRate` | 0 – 0.5 | Share of the gross premium |
| `profitMarginRate` | 0 – 0.3 | Share of the gross premium |
| `riskLoading.method` | `NONE` \| `EXPECTED_VALUE` \| `STANDARD_DEVIATION` | |
| `riskLoading.parameter` | 0 – 5 | θ (at most 1 for `EXPECTED_VALUE`, otherwise `422`) or k. Ignored for `NONE` |

**Example: the reference portfolio.**

```json
{
  "frequency": { "family": "BINOMIAL", "policies": 1000, "years": 1, "probability": 0.05 },
  "severity": { "family": "DETERMINISTIC", "mean": 1200 },
  "inflation": { "annualRate": 0, "years": 0 },
  "expenses": { "fixed": 20000, "perPolicy": 0, "variableRate": 0 },
  "profitMarginRate": 0,
  "riskLoading": { "method": "EXPECTED_VALUE", "parameter": 0.15 }
}
```

### Analysis bodies

| Endpoint | Body |
| --- | --- |
| `frequency/analyze` | `{ frequency }` |
| `severity/analyze` | `{ severity, thresholds? }`, where `thresholds` holds up to 5 claim costs ≥ 0 for \(P(X > t)\) |
| `aggregate/analyze` | `{ frequency, severity, thresholds? }`, where `thresholds` holds up to 5 totals for \(P(S > t)\) |

### Save body

`{ name, assumptions }`. The `name` field is trimmed and must be 1–80 characters of letters, digits, spaces and `. , ' & ( ) % + / -`.

### Simulation body (`POST /simulations`)

| Field | Type | Bounds | Notes |
| --- | --- | --- | --- |
| `assumptions` | pricing body | see above | The cover period `frequency.years` is the simulation horizon |
| `simulations` | integer | 1,000 – 200,000 | Simulated periods. Lognormal costs are also limited to 20,000,000 individual claim draws (simulations × expected claims), otherwise `422 SIMULATION_LIMIT` |
| `seed` | integer, optional | 1 – 2,147,483,647 | Omitted: the server draws one and returns it |
| `initialCapital` | number | 0 – 10,000,000,000, 3 decimals | Capital held at the start of the period (TND) |
| `premiumCharged` | number, optional | 1 – 100,000,000,000, 3 decimals | Gross premium actually charged. Omitted: the model's gross premium |
| `label` | string, optional | 1–80 characters, same characters as scenario names | Shown in the run list |

```json
{ "assumptions": { "…": "the reference portfolio above" }, "simulations": 20000, "seed": 20261109, "initialCapital": 5000, "label": "Reference, 5k capital" }
```

## 3. Responses

### `POST /pricing/calculate`

Abridged, with the values returned for the reference portfolio:

```json
{
  "provenance": { "kind": "ESTIMATED", "modelVersion": "pif-actuarial-1.0.0", "currency": "TND", "basis": "…" },
  "assumptions": { "…": "the validated inputs actually used" },
  "trendFactor": 1,
  "frequency": { "family": "BINOMIAL", "mean": 50, "variance": 47.5, "sd": 6.892024, "dispersionIndex": 0.95, "probabilityNoClaim": 5.29e-23, "probabilityPolicyClaims": 0.05, "probabilityAboveMean": 0.46247, "quantiles": [{ "level": 0.5, "value": 50 }], "distribution": { "from": 18, "binWidth": 2, "probabilities": [] } },
  "severity": { "family": "DETERMINISTIC", "mean": 1200, "sd": 0, "cv": 0, "parameters": { "value": 1200 }, "tailRatio": 1, "quantiles": [], "exceedance": [], "curve": null },
  "aggregate": {
    "mean": 60000, "sd": 8270.429, "cv": 0.13784,
    "distribution": { "available": true, "method": "EXACT", "span": 1200, "capturedMass": 0.9999999999996808, "latticeMean": 60000 },
    "risk": [{ "level": 0.995, "valueAtRisk": 82800, "tailValueAtRisk": 85216.092, "normalApproximation": 81303.214 }],
    "exceedance": [{ "threshold": 69000, "probability": 0.1389 }, { "threshold": 89000, "probability": 0.0004 }],
    "histogram": { "from": 34800, "binWidth": 1200, "probabilities": [] }
  },
  "premium": {
    "totals": { "purePremium": 60000, "riskLoading": 9000, "fixedExpenses": 20000, "technicalPremium": 89000, "variableExpenses": 0, "profitMargin": 0, "grossPremium": 89000, "expectedUnderwritingResult": 9000, "claimsBudget": 69000 },
    "perPolicy": { "purePremium": 60, "grossPremium": 89, "…": "…" },
    "purePremiumPerExposure": 60,
    "ratios": { "loss": 0.674157, "expense": 0.224719, "combined": 0.898876 },
    "underwritingMargin": 0.101124
  },
  "probabilities": { "underwritingLoss": 0.13891894630935067, "claimsExceedPremium": 0.00041134344207822586 },
  "sensitivities": [{ "driver": "frequency", "label": "Claim frequency +10%", "repricedGrossPremium": 95900, "repricedPerPolicy": 95.9, "premiumChange": 0.077528, "resultAtBasePremium": 3000 }],
  "warnings": []
}
```

Values shown as `…` or as empty arrays are abridged in this document; the API returns them in full. Probabilities are returned at full precision; some are rounded here for readability.

In this example, the frequency +10% sensitivity raises \(p\) to 5.5%. Expected claims become 66,000 and the loading 9,900, so the repriced gross premium is 95,900. Keeping the base premium of 89,000 instead would leave an expected result of \(89{,}000 - 66{,}000 - 20{,}000 = 3{,}000\).

**When the full distribution is unavailable** (very large expected claim counts, see the [models](mathematical-models.md#3-aggregate-loss-modelsaggregatets)), the response changes as follows:

- `aggregate.distribution` is `{ "available": false, "reason": "…" }`;
- `valueAtRisk`, `tailValueAtRisk`, exceedance probabilities and the two `probabilities` are `null`;
- the normal approximation is still returned;
- a warning explains why.

**Warnings** (plain English) are added when:

- the expected combined ratio is 100% or more;
- an underwriting loss is more likely than not;
- there is no loading and no margin;
- the distribution is unavailable.

### Analysis responses

| Endpoint | Response |
| --- | --- |
| `frequency/analyze` | `{ provenance, frequency }` (same object as in pricing) |
| `severity/analyze` | `{ provenance, severity }`. `exceedance` lists the requested thresholds; `curve` is a 101-point density (null for deterministic). For lognormal, `parameters` is `{ mu, sigma }` of ln X |
| `aggregate/analyze` | `{ provenance, aggregate }` |

### Scenarios

**Summary** (in the list and the overview):

```json
{ "id": "uuid", "name": "Reference base case", "kind": "PRICING", "modelVersion": "pif-actuarial-1.0.0", "currency": "TND", "stale": false,
  "headline": { "grossPremium": 89000, "grossPremiumPerPolicy": 89, "expectedClaims": 60000, "combinedRatio": 0.898876, "probabilityOfUnderwritingLoss": 0.1389 },
  "createdAt": "…", "updatedAt": "…" }
```

**Detail** adds `inputs` (the stored assumptions) and `results` (the stored pricing response). `stale: true` means the scenario was computed by another model version. It is shown as stored and flagged; it is not recomputed silently.

`GET /scenarios` returns `{ limit: 50, scenarios: [summary…] }`.

`GET /overview` returns `scenarios` in one of two shapes:

- `{ available: true, count, limit, recent }`;
- `{ available: false, reason }`, when the database migration has not been applied.

### Simulations

**Run** (`POST /simulations` and `GET /simulations/:id`). Abridged; the figures are those of the browser journey (reference portfolio, 20,000 periods, seed 20261109, capital 5,000):

```json
{
  "id": "uuid", "label": "E2E reference", "engineVersion": "pif-actuarial-mc-1.0.0", "currency": "TND", "stale": false,
  "seed": 20261109, "simulations": 20000, "durationMs": "…",
  "portfolio": { "frequency": "BINOMIAL", "severity": "DETERMINISTIC", "policies": 1000 },
  "headline": { "mean": "…", "valueAtRisk995": 81600, "tailValueAtRisk995": "…", "probabilityClaimsExceedBudget": 0.1421, "probabilityCapitalInsufficient": 0.0544, "premiumCharged": 89000, "initialCapital": 5000 },
  "createdAt": "…",
  "inputs": { "assumptions": { "…": "…" }, "initialCapital": 5000, "premiumCharged": null },
  "results": {
    "provenance": { "kind": "SIMULATED", "modelVersion": "pif-actuarial-mc-1.0.0", "currency": "TND", "basis": "Monte Carlo simulation from user-entered fictional assumptions, seed 20261109; rerunning with the same seed reproduces these figures." },
    "engineVersion": "pif-actuarial-mc-1.0.0", "rng": "mulberry32 (32-bit state) with Box–Muller normals", "seed": 20261109, "simulations": 20000,
    "thresholds": { "premiumCharged": 89000, "premiumSource": "MODEL", "modelGrossPremium": 89000, "fixedExpenses": 20000, "variableExpenses": 0, "claimsBudget": 69000, "initialCapital": 5000, "capitalThreshold": 74000 },
    "claimCount": { "mean": "…", "analyticMean": 50, "max": "…" },
    "statistics": { "mean": "…", "meanInterval": { "lower": "…", "upper": "…" }, "sd": "…", "median": "…", "min": "…", "max": "…", "skewness": "…" },
    "risk": [{ "level": 0.995, "valueAtRisk": 81600, "valueAtRiskInterval": { "lower": 81600, "upper": 82800 }, "tailValueAtRisk": "…", "tailValueAtRiskInterval": { "lower": "…", "upper": "…" }, "exactValueAtRisk": 82800, "exactTailValueAtRisk": 85216.092, "exactWithinInterval": true }],
    "probabilities": {
      "claimsExceedBudget": { "simulated": 0.1421, "interval": { "lower": 0.13733, "upper": 0.147008 }, "exact": 0.138919, "withinInterval": true, "count": 2842 },
      "claimsExceedPremium": { "simulated": 0.00025, "interval": { "lower": 0.000107, "upper": 0.000585 }, "exact": 0.000411, "withinInterval": true, "count": 5 },
      "capitalInsufficient": { "simulated": 0.0544, "interval": { "lower": 0.051341, "upper": 0.05763 }, "exact": 0.05111, "withinInterval": false, "count": 1088 }
    },
    "expectedShortfall": "…",
    "analytic": { "mean": 60000, "sd": 8270.429, "distribution": { "available": true, "method": "EXACT" }, "meanWithinInterval": true },
    "histogram": { "from": "…", "binWidth": "…", "counts": [], "above": "…" },
    "exceedanceCurve": [{ "threshold": "…", "simulated": "…", "exact": "…" }],
    "convergence": [{ "simulations": 500, "mean": "…", "lower": "…", "upper": "…", "probabilityClaimsExceedBudget": "…" }]
  }
}
```

Values shown as `…` are abridged, and probabilities are rounded to 6 decimals here (the API returns full precision). The intervals and exact tails were recomputed independently from the counts: Wilson intervals, and \(P(N \ge 58)\), \(P(N \ge 62)\), \(P(N \ge 75)\) for Binomial(1000, 5%). `id`, `createdAt` and `durationMs` vary from run to run; every other field is reproduced exactly by the same inputs and seed. In this run, the exact \(P(S > 74{,}000)\) lies just outside its simulated interval: about 1 interval in 20 does, by chance alone.

**Field notes:**

- `exact`, `exactValueAtRisk`, `exactTailValueAtRisk` and the `withinInterval` flags are `null` when the exact distribution is unavailable. `analytic.distribution` then gives the reason.
- `tailValueAtRiskInterval` is `null` when fewer than 10 periods lie beyond the VaR.
- `histogram.above` counts the periods beyond the 99.9% quantile, so `sum(counts) + above = simulations`.
- `stale: true` marks a run stored by another engine version. It is shown as stored, never recomputed silently.

`GET /simulations` returns `{ kept: 25, runs: [summary…] }`. A summary is the run above without `inputs` and `results`.

`GET /overview` returns `simulations` in one of two shapes:

- `{ available: true, count, kept: 25, recent }`, with the five most recent summaries;
- `{ available: false, reason }`, when the simulation migration has not been applied.

**Retention.** Each user keeps their 25 most recent runs. Saving a run deletes the older ones, in the same transaction, under a per-user advisory lock. Individual simulated totals are never stored.

### Claims reserving

Rate limits: 120 requests per minute on the reserving routes; `POST /reserving/analyze` and `POST /reserving/runs` allow 60. The formulas are in [mathematical-models.md §8](mathematical-models.md#8-claims-reserving-modelsreservingts).

**Body** of `POST /reserving/analyze`. `POST /reserving/runs` takes the same body plus `label` (1 to 80 characters: letters, digits, spaces and `. , ' & ( ) % + / – -`).

```json
{
  "data": {
    "firstOrigin": 2023,
    "paid": [[100, 150, 165], [120, 186], [130]],
    "incurred": [[160, 170, 168], [190, 210], [200]],
    "premiums": [200, 220, 240]
  },
  "assumptions": {
    "average": "VOLUME_WEIGHTED",
    "tail": { "paid": 1, "incurred": 1 },
    "selectedFactors": { "paid": [null, 1.1], "incurred": null },
    "expectedLossRatio": 0.8
  }
}
```

| Field | Rule |
| --- | --- |
| `data.firstOrigin` | Integer; all accident years within 1950–2100 |
| `data.paid` | 3 to 25 rows of **cumulative** amounts; row \(k\) (0-based) has \(n - k\) amounts; `null` = missing (never zero); the last amount of each row is required |
| `data.incurred` | Optional, same shape as `paid` (paid + case reserves) |
| `data.premiums` | Optional, one positive earned premium per accident year |
| `assumptions.average` | `VOLUME_WEIGHTED`, `SIMPLE_AVERAGE` or `LATEST_DIAGONALS` |
| `assumptions.latestDiagonals` | Required with `LATEST_DIAGONALS`: integer 1 to \(n - 1\) |
| `assumptions.tail` | `paid` and `incurred`, each 0.5 to 3 |
| `assumptions.selectedFactors` | Optional; `paid` and `incurred`, each \(n - 1\) entries of `null` (keep the estimate) or 0.1 to 100 |
| `assumptions.expectedLossRatio` | Optional, 0.01 to 5; used only with premiums |

**Analysis response** (abridged; figures of the request above):

```json
{
  "provenance": { "kind": "MODEL_ESTIMATE", "currency": "TND", "modelVersion": "pif-reserving-1.0.0", "note": "Deterministic best estimates … Undiscounted, without a risk margin; not a regulatory technical provision." },
  "results": {
    "modelVersion": "pif-reserving-1.0.0", "firstOrigin": 2023, "origins": [2023, 2024, 2025], "valuationYear": 2025,
    "averaging": { "method": "VOLUME_WEIGHTED", "latestDiagonals": null },
    "chainLadder": {
      "paid": {
        "basis": "PAID", "tail": 1, "cdf": [1.68, 1.1, 1], "percentDeveloped": [0.595, 0.909, 1],
        "factors": [{ "from": 1, "to": 2, "pairs": 2, "volumeWeighted": 1.5273, "simpleAverage": 1.525, "latestDiagonals": null, "min": 1.5, "max": 1.55, "estimated": 1.5273, "selected": 1.5273, "source": "ESTIMATED" }, "…"],
        "linkRatios": "…", "incremental": "…", "projected": "…",
        "origins": [{ "origin": 2025, "age": 1, "latest": 130, "cdf": 1.68, "ultimate": 218.4, "development": 88.4 }, "…"],
        "totals": { "latest": 481, "ultimate": 588, "development": 107 }
      },
      "incurred": { "…": "same shape" }
    },
    "paidVsIncurred": { "origins": ["…"], "totals": { "paidUltimate": 588, "incurredUltimate": 590.118, "difference": -2.118, "relativeDifference": -0.0036 } },
    "reserves": { "origins": [{ "origin": 2023, "premium": 200, "paid": 165, "incurred": 168, "caseReserve": 3 }, "…"], "totals": { "premium": 660, "paid": 481, "incurred": 578, "caseReserve": 97 } },
    "methods": [
      { "method": "CHAIN_LADDER_PAID", "available": true, "origins": ["…"], "totals": { "ultimate": 588, "unpaid": 107, "ibnr": 10 } },
      { "method": "EXPECTED_LOSS_RATIO", "available": true, "origins": ["…"], "totals": { "ultimate": 528, "unpaid": 47, "ibnr": -50 } },
      "…"
    ],
    "reconciliation": { "holds": true, "maxDifference": 0 },
    "sensitivity": {
      "scenarios": [{ "id": "base", "label": "Base assumptions", "unpaid": { "CHAIN_LADDER_PAID": 107, "…": "…" }, "change": { "CHAIN_LADDER_PAID": 0, "…": "…" }, "note": null }, "…"],
      "factors": [{ "basis": "PAID", "from": 1, "to": 2, "change": 2.184 }, "…"]
    },
    "cashFlows": { "basis": "CHAIN_LADDER_PAID", "currency": "TND", "valuationYear": 2025, "discounting": "NONE", "periods": [{ "calendarYear": 2026, "expectedPayment": 87.145 }, { "calendarYear": 2027, "expectedPayment": 19.855 }], "afterLastDevelopmentYear": 0, "total": 107 },
    "warnings": [
      { "code": "PAID_TAIL", "message": "The last paid factor (1.1000) shows development is still under way, but the tail factor is 1: …" },
      { "code": "INCURRED_SINGLE_PAIR", "message": "The incurred factors 2–3 rest on a single accident year; …" },
      { "code": "EXPECTED_LOSS_RATIO_NEGATIVE_UNPAID", "message": "Expected loss ratio gives an ultimate below the amount already paid for 2023." }
    ]
  }
}
```

Factors and ratios are shown here rounded to 4 decimals and amounts to 3; the API returns full precision. A method that cannot be computed is `{ "method": …, "available": false, "reason": "…" }`.

**Runs.** `POST /reserving/runs` and `GET /reserving/runs/:id` return `{ id, label, modelVersion, stale, currency, firstOrigin, originCount, valuationYear, dataChecksum, headline, createdAt, inputs, results }`. `headline` holds paid, incurred, case reserves, the ultimate and unpaid of each method, and the number of warnings. `dataChecksum` is the SHA-256 of the triangles and premiums: identical data give the same checksum. `GET /reserving/runs` returns `{ kept: 25, runs: [summary…] }`, without `inputs` and `results`. Each user keeps their 25 most recent runs (older ones are deleted in the same transaction, under a per-user advisory lock).

`GET /overview` returns `reserving` as `{ available: true, count, kept: 25, recent }` (five most recent: id, label, valuation year, date) or `{ available: false, reason }` when the reserving migration has not been applied.

## 4. Errors

Standard platform shape: `{ statusCode, message, errorCode, details? }`.

| Status | `errorCode` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing, unknown or out-of-range field; missing `probability`, `intensity` or `cv` for the chosen family; invalid scenario name or run label; simulation count, seed or capital out of range; malformed UUID. Field messages are in `details` |
| 401 | `UNAUTHENTICATED` | No or invalid access token |
| 404 | `SCENARIO_NOT_FOUND` | Unknown id, or a scenario owned by someone else (indistinguishable on purpose) |
| 404 | `SIMULATION_NOT_FOUND` | Unknown run id, or a run owned by someone else (indistinguishable on purpose) |
| 404 | `RESERVING_RUN_NOT_FOUND` | Unknown reserving run id, or one owned by someone else (indistinguishable on purpose) |
| 422 | `INVALID_TRIANGLE` | Rows of the wrong length, a missing latest amount, a negative or non-numeric amount, premiums of the wrong length, a parameter out of range, or incurred factors without an incurred triangle. The message names the accident year and development year |
| 422 | `FACTOR_UNDEFINED` | No pair can estimate a development factor (all missing, or zero bases). The message names the period; select a factor for it |
| 409 | `SCENARIO_NAME_TAKEN` | You already have a scenario with this name |
| 409 | `SCENARIO_LIMIT` | You already have 50 scenarios |
| 422 | `INVALID_ASSUMPTIONS` | Valid fields that the model rejects together: variable rate + margin ≥ 100%, or θ > 1 with the expected-value principle |
| 422 | `SIMULATION_LIMIT` | A lognormal run would need more than 20,000,000 claim draws. The message gives the largest run that fits. Checked before any sampling |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 503 | `DATABASE_SCHEMA_OUTDATED` | Scenario, simulation or reserving-run endpoints on a database where the corresponding migration has not been applied (`POST /reserving/analyze` still works). For `POST /simulations`, the run is computed and then cannot be stored, so nothing is returned |
| 503 | `SIMULATION_BUSY` | 2 runs are executing and 6 are waiting. Try again in a few seconds |
| 503 | `SIMULATION_TIMEOUT` | The run took more than 30 seconds and was stopped. Nothing is stored |
