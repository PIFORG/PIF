# Actuarial Lab: validation (Phases 1 to 3)

Every result below was produced by running the code on 9 Nov 2026. API end-to-end tests and browser journeys run against the disposable database `PIF_test`, never against `PIF`. Phase 2 (Monte Carlo) is in [section 6](#6-phase-2-monte-carlo-lab); Phase 3 (claims reserving) is in [section 7](#7-phase-3-claims-reserving).

## 1. Method

1. **Hand calculations first.** Each formula has at least one test whose expected value is computed independently. The independent calculation is a closed form, a recurrence, a semi-analytic sum or a numerical integral, not the code under test.
2. **No tolerance relaxed to make a test pass.** When the Panjer mean for the lognormal preset came out 4.5% low, the discretisation was changed (rounding replaced by mean-preserving local moment matching). The test tolerance stayed at 0.2%.
3. **Server and screen agree.** The browser journey reads figures from the rendered page. It compares them with values computed independently inside the test script, for example the exact Binomial tail.

## 2. Reference values

### Reference dataset (master prompt §15)

1,000 policies, Binomial with \(p = 5\%\), every claim costs 1,200 TND, fixed expenses 20,000 TND, expected-value loading 15%.

| Quantity | Independent value | API |
| --- | --- | --- |
| \(E[N]\), \(\mathrm{Var}(N)\) | 50, 47.5 | 50, 47.5 |
| \(E[S]\) | 60,000 | 60,000.000 |
| \(\mathrm{sd}(S) = 1200\sqrt{47.5}\) | 8,270.429 | 8,270.429 |
| Risk loading, gross premium, per policy | 9,000; 89,000; 89 | 9,000.000; 89,000.000; 89.000 |
| Claims budget | 69,000 | 69,000.000 |
| Loss, expense and combined ratios | 67.42%, 22.47%, 89.89% | 0.674157, 0.224719, 0.898876 |
| \(P(S > 69{,}000) = P(N \ge 58)\) | 13.8919% (exact Binomial tail, computed in the journey script) | 13.8919% |
| \(\mathrm{VaR}_{99.5\%}\); normal approximation | \(1200 \times q_{99.5\%}(N) = 1200 \times 69\); \(60{,}000 + 8{,}270.429 \times 2.5758\) | 82,800; 81,303.214 |

### Motor preset (Poisson, gamma claim cost)

5,000 policies, \(\mu = 0.08\), gamma claim cost with mean 1,800 and CV 0.9, inflation 4% for one year, fixed expenses 60,000 plus 12 per policy, variable expenses 15%, margin 5%, standard-deviation loading with \(k = 0.5\).

| Quantity | Independent value | API |
| --- | --- | --- |
| \(\lambda\) | \(5000 \times 0.08 = 400\) | 400 |
| \(E[X]\) after inflation | \(1800 \times 1.04 = 1872\) | 1,872 |
| Gamma shape and scale | \(1/0.81 = 1.234568\); \(1872 \times 0.81 = 1516.32\) | 1.2345679; 1,516.32 |
| \(E[S]\) | 748,800 | 748,800.000 |
| \(\mathrm{sd}(S) = \sqrt{\lambda E[X^2]} = \sqrt{400 \times 1872^2 \times 1.81}\) | 50,370.368 | 50,370.368 |
| Loading \(0.5\,\mathrm{sd}\) | 25,185.184 | 25,185.184 |
| Fixed expenses | \(60{,}000 + 12 \times 5000 = 120{,}000\) | 120,000.000 |
| Technical, then gross \(= P_T/0.8\) | 893,985.184; 1,117,481.480 | 893,985.184; 1,117,481.480 |
| Expected result \(= RL + m P_G\) | \(25{,}185.184 + 55{,}874.074 = 81{,}059.258\) | 81,059.258 |
| Panjer lattice mean | 748,800 (must equal \(E[S]\)) | 748,800.000 (captured mass 1.0000000) |

### Home preset (Poisson, lognormal claim cost)

8,000 policies, \(\mu = 0.03\), lognormal claim cost with mean 4,500 and CV 2.5, inflation 3%, standard-deviation loading with \(k = 1\).

| Quantity | Independent value | API |
| --- | --- | --- |
| \(E[X]\) | \(4500 \times 1.03 = 4635\) | 4,635 |
| \(\sigma = \sqrt{\ln(1 + 2.5^2)}\); \(\mu = \ln 4635 - \sigma^2/2\) | 1.4074805; 7.4508907 | 1.4074805; 7.4508907 |
| \(E[S]\); \(\mathrm{sd}(S) = \sqrt{240 \times 4635^2 \times 7.25}\) | 1,112,400; 193,341.179 | 1,112,400.000; 193,341.179 |
| Panjer lattice mean | 1,112,400 | 1,112,399.507 (−0.00004%) |
| Gross premium | \((1{,}112{,}400 + 193{,}341.179 + 144{,}000)/0.8\) = 1,932,988.239 | 1,932,988.239 |
| \(\mathrm{VaR}_{99.5\%}\) vs normal approximation | Heavy tail, so the exact VaR must be larger | 1,793,344.111 vs 1,610,413.874 |

## 3. Automated tests

### API unit tests: `npx jest src/actuarial`, 34 tests, all pass

| File | Tests | What they establish |
| --- | --- | --- |
| `math/special.spec.ts` | 5 | \(\ln\Gamma\) against factorials, \(\Gamma(\tfrac12) = \sqrt\pi\) and \(\ln\Gamma(170)\); \(\ln\binom{n}{k}\); incomplete gamma against \(Q(n, x) = e^{-x}\sum_{k<n} x^k/k!\); \(\Phi\) and \(\Phi^{-1}\) against standard tables, including the tails; generic inversion against the exponential quantile |
| `models/models.spec.ts` | 24 | See the list below |
| `actuarial.view.spec.ts` | 5 | See the list below |

`models/models.spec.ts` covers:

- **Frequency:**
  - Binomial moments and pmf recurrence;
  - \(p_t = 1-(1-p)^t\);
  - Poisson \(\lambda = n t \mu\) and pmf;
  - count-table coverage, quantiles and exceedance;
  - rejected assumptions.
- **Severity:**
  - deterministic point mass;
  - gamma shape and scale, with the exponential special case;
  - gamma density integrates to 1 and has mean \(m\);
  - lognormal \(\mu, \sigma\) kept distinct from the arithmetic mean and CV;
  - limited expected value against the exponential closed form \(\theta(1 - e^{-d/\theta})\) and against numerical integration of the survival function;
  - the trend factor.
- **Aggregate:**
  - reference moments;
  - exact lattice \(S = 1200N\);
  - VaR and TVaR on a two-point law;
  - Panjer for one Bernoulli policy reproduces \(f_S(0) = q + p x_0\), \(f_S(j) = p x_j\);
  - Panjer against the semi-analytic compound Poisson–exponential tail \(\sum_n P(N=n)\,Q(n, s/\theta)\), within \(2 \times 10^{-3}\);
  - Panjer preserves the analytic mean of both presets within 0.2%;
  - the distribution is reported unavailable when \(f_S(0)\) underflows;
  - histogram mass.
- **Pricing:**
  - the 60,000 / 9,000 / 20,000 / 89,000 build-up;
  - the gross-up \(P_T/(1-v-m)\);
  - the motor preset;
  - sensitivities, both repriced and at the base premium;
  - rejection of \(v + m \ge 1\).

`actuarial.view.spec.ts` covers:

- the millime-rounded reference build-up, per portfolio and per policy;
- exceedance thresholds equal to the claims budget and gross premium, with \(P(S > B)\) equal to the reported probability of an underwriting loss;
- plain-JSON responses (no functions or typed arrays);
- the "no loading, no margin" warning;
- lognormal parameters labelled apart from the mean;
- the unavailable distribution (moments kept, figures `null`).

### API end-to-end: `test/actuarial.e2e-spec.ts` on `PIF_test`, 8 tests, all pass

| Test | Proves |
| --- | --- |
| Requires authentication | `401` on overview, presets, pricing and scenarios without a token |
| Presets | Three fictional presets; the reference headline is 89,000 / 89 per policy |
| Reference pricing | The full build-up over HTTP equals the hand calculation |
| Gross-up and Panjer | Pure premium 720,000 and gross premium \((720{,}000 + 120{,}000)/0.8\) for the motor book without inflation or loading; gamma costs use `PANJER`; gamma shape \(1/0.81\) |
| Separate analyses | Poisson \(E[N] = \mathrm{Var}(N) = 2\) and \(P(N=0) = e^{-2}\); exponential \(P(X > 1000) = e^{-1}\); reference \(E[S] = 60{,}000\) with a 99.5% VaR on the 1,200 lattice |
| Validation | `400` for a missing probability, a `NORMAL` severity, a missing CV, too many policies and unknown fields. `422 INVALID_ASSUMPTIONS` for θ > 1 |
| Scenarios | Save (201) with server-computed results; duplicate name `409`; unsafe name `400`; client-supplied `results` rejected `400`; another user sees nothing and gets `404` on read and delete; malformed id `400`; the overview counts 1 of 50; delete `204`, then `404` |
| Stale flag | A scenario stored under an older model version is returned with `stale: true` |

### Web unit tests (Vitest)

| File | Tests | Proves |
| --- | --- | --- |
| `components/actuarial/assumptionForm.test.ts` | 5 | Rates shown in percent round-trip exactly to API ratios; only the fields of the selected families are sent; the standard-deviation loading stays a multiple; bounds mirror the server with field messages; a hidden family field is ignored |
| `components/actuarial/PricingStudio.test.tsx` | 3 | Loads the reference preset and shows the server build-up; invalid input never reaches the API; switching to Poisson and rapid edits are debounced into one request |
| `lib/navigation/workspaceNav.test.ts` | updated | `/actuarial` listed as a live module |

## 4. Browser verification

`npm run test:e2e:actuarial` drives Microsoft Edge through the DevTools protocol against the production builds: the API on `PIF_test`, with mail in preview mode. It registers a throwaway account and verifies it through the captured link. Result: **36 of 36 checks pass.** They cover:

1. **Overview:**
   - live, labelled fictional reference portfolio with its distribution chart;
   - four planned workspaces shown as planned, not linked;
   - no "backend pending" label;
   - the empty scenario state;
   - KPIs of 89,000 DT and 60,000 DT.
2. **Studio, reference portfolio:**
   - the 60,000 + 9,000 + 20,000 = 89,000 build-up, 89 per policy;
   - the displayed P(underwriting loss) is within 0.006 percentage points of the exact Binomial tail (13.89% shown vs 13.8919%);
   - loss ratio 67.4%, combined ratio 89.9%;
   - the deterministic-cost note;
   - sd(S) = 8,270.429.
3. **Poisson:** E[S] unchanged and dispersion index exactly 1; the preset selector switches to "Custom assumptions".
4. **Lognormal:**
   - μ and σ labelled as parameters of ln X;
   - density drawn;
   - Panjer used;
   - the exact 99.5% quantile above the normal approximation (153,377.813 vs 118,850.795 in the run).
5. **Validation:** an invalid policy count shows a field error and stops recalculation.
6. **Gross-up:** gross = technical ÷ 0.8, and variable expenses = 15% of gross.
7. **Scenarios:**
   - the saved scenario is listed with the per-policy premium the server computed for it;
   - a duplicate name is rejected;
   - loading the scenario restores its assumptions.
8. **Accessibility:**
   - every input labelled;
   - toggles expose `aria-pressed`;
   - the status is a polite live region;
   - tables captioned;
   - charts described.
9. **Overview after saving:** shows "1 of 50 saved"; the scenario is then deleted after confirmation.
10. **Responsive and errors:**
    - no horizontal overflow at 1440, 768 and 375 px on every page;
    - no uncaught page errors.

### Screenshots

Stored in `docs/actuarial/screenshots/`:

| Page or panel | File (desktop / tablet / mobile) |
| --- | --- |
| Overview | `A01-overview-{desktop,tablet,mobile}.png` |
| Studio, reference portfolio | `A02-pricing-reference-{desktop,tablet,mobile}.png` |
| Studio, lognormal book | `A03-pricing-lognormal-{desktop,tablet,mobile}.png` |
| Premium build-up | `A02a-premium-buildup.png`, mobile `A02d-premium-buildup-mobile.png` |
| Aggregate distribution | `A02b-aggregate-distribution.png`, mobile `A02e-aggregate-distribution-mobile.png` |
| Assumption form | `A02c-assumptions.png` |
| Lognormal severity | `A03a-severity-lognormal.png` |
| Poisson frequency | `A03b-frequency-poisson.png` |
| Sensitivities | `A03c-sensitivity.png` |

## 5. Regression of the rest of the platform (Phase 1)

Run after the Phase 1 changes on 9 Nov 2026. The Phase 2 regression is in section 6.6.

| Suite | Result |
| --- | --- |
| API unit tests (all modules) | 533 / 533 |
| API e2e: auth, email flows, learning, trading, actuarial (`PIF_test`) | 40 / 40 in 5 suites |
| API `tsc --noEmit` and ESLint | Clean |
| Web Vitest (all) | 132 / 132 in 24 files |
| Web `tsc --noEmit` and `next lint` | Clean |
| API and web production builds | Succeed |
| Trading browser journey | 50 / 50 |
| Learning browser journey | 77 / 77 |

One existing API unit test changed. `auth.service.spec.ts` had hard-coded "trading capability is false", which was written before the order desk existed. The test now asserts the actual invariant: every capability equals "module permitted and available". It also asserts explicitly that AI analysis and stress testing remain unavailable.

## 6. Phase 2: Monte Carlo Lab

### 6.1 Method

**Random results are never required to equal analytic moments.** Every comparison between a simulation and an exact value uses a tolerance derived from the sampling distribution of the estimator:

| Comparison | Tolerance |
| --- | --- |
| A mean, variance or probability | 5 standard errors of the estimator |
| A whole distribution | The Dvoretzky–Kiefer–Wolfowitz bound \(P(\sup_x \lvert F_n(x) - F(x)\rvert > \varepsilon) \le 2e^{-2n\varepsilon^2}\), with \(\varepsilon = \sqrt{\ln(2/10^{-6})/(2n)}\), so that a correct sampler fails with probability below one in a million |
| A VaR | The share of simulated periods at or below the exact VaR is Binomial\((n, \alpha)/n\): 5 standard errors, plus \(10^{-3}\) for the Panjer grid step |

The seeds are fixed, so each test run is identical, and a failure would be reproducible.

**One tolerance is looser than its neighbours.** It belongs to a new frequency test for the largest portfolio the API accepts (10 million expected claims). It checks that the count table holds all the probability mass to 7 decimal places, not 12. The reason: \(\ln\Gamma(10^7) \approx 1.5 \times 10^8\), so double precision leaves each log-probability accurate to only about \(10^{-8}\). The test file states this.

### 6.2 Reference values

**Reference portfolio, seed 20261109, 20,000 periods, initial capital 5,000** (the browser journey run; also the example in [api.md](api.md#simulations)):

| Quantity | Independent value | Simulated (95% interval) | Exact in interval |
| --- | --- | --- | --- |
| Claims budget \(B\); capital threshold \(B + C\) | 69,000; 74,000 | 69,000.000; 74,000.000 | — |
| \(E[S]\) | 60,000 | 60,017 (59,902 – 60,133) | Yes |
| \(P(S > 69{,}000) = P(N \ge 58)\) | 13.8919% | 14.21% (13.73% – 14.70%), 2,842 periods | Yes |
| \(P(S > 89{,}000) = P(N \ge 75)\) | 0.0411% | 0.025% (0.011% – 0.059%), 5 periods | Yes |
| \(P(S > 74{,}000) = P(N \ge 62)\) | 5.1110% | 5.44% (5.13% – 5.76%), 1,088 periods | **No**, by 0.02 points |
| \(\mathrm{VaR}_{99.5\%}\) | 82,800 | 81,600 (81,600 – 82,800) | Yes |
| \(\mathrm{TVaR}_{99.5\%}\) | 85,216.092 | 84,636 (83,855 – 85,417) | Yes |

The independent values are exact Binomial(1000, 5%) tails and Wilson intervals, computed outside the application from the displayed counts.

**The one miss is expected.** The simulated \(P(S > 74{,}000)\) is \((0.0544 - 0.0511)/\sqrt{0.0511 \times 0.9489/20{,}000} \approx 2.1\) standard errors above the exact value. With 95% intervals, about 1 in 20 misses by chance. The two threshold probabilities come from the same 20,000 periods, so they tend to miss together; here the budget probability is also high, by 1.3 standard errors. The page says that a single miss is not an error. A test that required every interval to contain the exact value would be wrong about 5% of the time per interval.

**Fixed claim cost.** Every simulated total is a whole number of 1,200 claims, and so are the simulated VaRs (81,600 = 68 × 1,200).

### 6.3 API unit tests: `npx jest src/actuarial`, 64 tests, all pass

| File | Tests | What they establish |
| --- | --- | --- |
| `models/simulation.spec.ts` | 26 | See the list below |
| `simulation.runner.spec.ts` | 2 | Under ts-jest, where the compiled worker does not exist, the runner works in-process and gives the same result as a direct run. With a controlled worker: 2 run at once, 6 wait, the ninth request is refused with a capacity error; the queued runs complete in order and every slot is freed |
| `actuarial.view.spec.ts` | 6 (1 new) | Monte Carlo results are labelled `SIMULATED` with the engine version; thresholds 89,000, 69,000 and 74,000; amounts rounded to the millime; the histogram bin width is a multiple of 1,200; the exact \(P(S > B) = 0.138919\) |
| `models/models.spec.ts` | 25 (1 new) | Phase 1 tests, plus the count table of the largest accepted portfolio (section 6.1) |
| `math/special.spec.ts` | 5 | Unchanged |

`models/simulation.spec.ts` covers:

- **Exact samplers:**
  - the same seed replays the same stream; another seed does not;
  - gamma with shapes 0.04, 0.5, 1.2346 and 40: mean and variance within 5 standard errors; all values positive and finite;
  - gamma shape 1.5: the empirical CDF stays within the DKW band of \(P(k, x)\);
  - Binomial (30, 20%), (1000, 5%) and (1,000,000, 30%): mean and variance within 5 standard errors; whole numbers in \([0, n]\);
  - Binomial(1000, 5%) and Poisson(400): the whole empirical distribution within the DKW band of the exact pmf;
  - Poisson 2.5, 400 and 1,000,000: mean and variance within 5 standard errors.
- **Estimators, against hand calculations on the values 1 … 10:**
  - VaR at 90% is 9 and at 85% is 9;
  - TVaR at 85% is \(1.45/0.15\);
  - a total equal to the threshold is not an exceedance;
  - Wilson: 0 of 100 gives \([0, 0.036994]\); 50 of 100 gives \([0.403832, 0.596168]\);
  - the order-statistic interval for the 99% quantile of 1 … 10,000 is positions 9,880 to 9,920.
- **Runs:**
  - reproducible: identical JSON for the same inputs and seed;
  - reference portfolio, 100,000 periods: the exact \(P(S > B) = 0.138919\); the simulated value within 5 standard errors; the mean within 5 standard errors of 60,000; every total a multiple of 1,200; the exceedance curve within the DKW band of the exact curve;
  - motor (gamma), 100,000 periods: Panjer comparison; mean within 5 standard errors; sd within 2%; claim count within 5 standard errors of 400; the share below each exact VaR within tolerance; TVaR 99.5% within 1%;
  - home (lognormal), 40,000 periods: mean and all three threshold probabilities within 5 standard errors of Panjer; positive skewness;
  - a custom premium of 80,000 gives \(B = 60{,}000\) and \(B + C = 72{,}000\); exceedance counts equal direct counts of \(N > 50\) and \(N > 60\); the expected shortfall equals a direct computation; the exact column equals \(1 - F_{\mathrm{Bin}}(50)\);
  - very large capital: no insufficient period, an upper interval bound above 0, a shortfall of 0;
  - histogram: every period counted (bins + `above`); bins of whole claims for a fixed cost; the convergence trace ends at the final estimates;
  - limits: 999 and 200,001 periods, seed 0 and negative capital are refused; the lognormal home book at 200,000 periods (48 million draws) is refused with "at most 83,333 simulations".

### 6.4 API end-to-end: `test/actuarial-simulation.e2e-spec.ts` on `PIF_test`, 4 tests, all pass

The Monte Carlo tests have their own file because the sign-in limit (10 per minute per client) would otherwise be exceeded in one file.

| Test | Proves |
| --- | --- |
| Requires authentication | `401` on run, list, read and delete without a token |
| Seeded run | Reference portfolio, seed 42, 2,000 periods, capital 5,000: `201`; `SIMULATED` provenance; thresholds 89,000, 69,000 and 74,000; exact mean 60,000 and \(P(S > B) = 0.138919\); histogram counts plus `above` equal 2,000; the response stays under 40,000 characters, so no individual losses are returned. The same request again returns identical results except `id`, `createdAt` and `durationMs`; seed 43 gives a different mean. Without a seed, the server picks a valid one and returns it; a premium of 80,000 is reported as `USER` with \(B = 60{,}000\) |
| Validation | `400` for 999 periods, seed 0 and client-supplied results; `422 SIMULATION_LIMIT` for a 200,000-period lognormal run of 1,000 expected claims (200 million draws), and nothing is stored |
| Ownership and retention | Another user gets `404` on read and delete and sees an empty list; malformed id `400`, unknown id `404`. With 25 older runs on record, one more run removes the two oldest (27 → 25); the newest is listed first; a run stored under an older engine version is flagged `stale: true`; summaries carry no `results`; the overview reports 25 runs kept of 25; delete `204`, then `404` |

`test/actuarial.e2e-spec.ts` (8 tests, Phase 1) still passes; together, 12 actuarial e2e tests.

### 6.5 Web and browser

**Vitest:**

| File | Tests | Proves |
| --- | --- | --- |
| `components/actuarial/MonteCarloLab.test.tsx` | 4 | No results until the server completes a run, then labelled simulated; settings validated locally, and an entered premium and label are sent; "New seed" stays in range and marks shown results as outdated; a stored run loads with its inputs; server errors are explained in plain English |
| `components/actuarial/assumptionForm.test.ts` | 8 (3 new) | Simulation settings accept the server ranges and omit an empty premium and label; sizes, seeds and labels the server would refuse are rejected; seeds are drawn in 1 … 2,147,483,647 |
| `components/actuarial/PricingStudio.test.tsx` | 3 | Unchanged behaviour after moving the form into `AssumptionsForm.tsx`; the Monte Carlo tab links to `/actuarial/monte-carlo` and Reserving stays disabled |

**Browser journey.** `npm run test:e2e:actuarial` against production builds, with the API on `PIF_test`: **56 of 56 checks pass** (36 from Phase 1, 20 new). The Monte Carlo steps:

10. The lab opens with "No simulation yet" and no figures. A run of the reference portfolio (20,000 periods, seed 20261109, capital 5,000) shows:
    - thresholds 69,000 and 74,000;
    - an exact column equal to \(P(N \ge 58)\) and \(P(N \ge 62)\), computed independently in the script (13.89% and 5.11%);
    - a simulated \(P(S > B)\) within 4 standard errors of the exact value (14.21% against 13.8919%, standard error 0.245%);
    - the capital-insufficiency probability with its interval;
    - the "simulated" label with the seed, and the histogram, exceedance (simulated and exact) and convergence charts;
    - a 99.5% VaR that is a multiple of 1,200 (81,600).
11. Rerunning with the same seed reproduces every displayed figure; both runs are listed.
12. **The event loop stays free.** During an 80,000-period lognormal run (about 1.6–2.2 s in the three runs), five health requests from the page were answered in 3–8 ms each.
13. A new seed marks the shown results as belonging to the previous inputs.
14. Loading the first run restores its seed, size and capital, and shows exactly the stored figures. The heavy run is deleted after confirmation.
15. Accessibility: settings labelled, status a polite live region, tables captioned, charts described. The overview lists the recent runs ("2 kept") and links each workspace to its page.

No horizontal page overflow at 1440, 768 and 375 px, and no uncaught page errors.

**Screenshots** in `docs/actuarial/screenshots/`:

| Page or panel | File |
| --- | --- |
| Monte Carlo Lab, reference run | `A04-monte-carlo-reference-{desktop,tablet,mobile}.png` |
| Simulated distribution | `A04a-simulated-distribution.png` |
| Simulated against exact | `A04b-simulated-vs-exact.png`, mobile `A04f-simulated-vs-exact-mobile.png` |
| Exceedance curve | `A04c-exceedance.png` |
| Convergence | `A04d-convergence.png` |
| Run settings | `A04e-simulation-settings.png` |
| Lognormal run against Panjer | `A04g-lognormal-simulated-vs-exact.png` |

### 6.6 Regression of the whole platform (Phase 2)

| Suite | Result |
| --- | --- |
| API unit tests (all modules) | 563 / 563 in 36 suites |
| API e2e: auth, email flows, learning, trading, actuarial, Monte Carlo (`PIF_test`) | 44 / 44 in 6 suites |
| API `tsc --noEmit` and ESLint (`src`, `test`) | Clean |
| Web Vitest (all) | 139 / 139 in 25 files |
| Web `tsc --noEmit` and ESLint | Clean |
| API and web production builds | Succeed |
| Actuarial browser journey | 56 / 56 |
| Trading browser journey | 50 / 50 |
| Learning browser journey | 77 / 77 |

**A trading test failure found and fixed during this regression.** `test/trading.e2e-spec.ts` ("buys and sells with server-side accounting…") failed 4 times out of 4. It expects the execution history newest first, `['SELL', 'BUY']`, and received `['BUY', 'SELL']`.

- **Cause.** The history is ordered by `executedAt`, then `recordedAt`. The test freezes the market clock, so both fills share `executedAt`. The service also wrote `recordedAt` from that same injected clock (`recordedAt: ctx.now`), so the tie-breaker tied too. PostgreSQL then returns tied rows in an unspecified order, which can change from one run to the next; the test had passed in the Phase 1 regression.
- **Fix.** One line in `apps/api/src/trading/portfolios.service.ts`: `recordedAt` is no longer set from the market clock, so it takes its schema default, the time the row is written. This matches the cash ledger, whose `createdAt` tie-breaker already worked this way. In production the market clock is the system clock, so the stored values are unchanged in practice.
- **The test was not modified.** After the fix it passed 3 times out of 3 on its own, then in the full suite, and the trading browser journey passed 50 of 50.
- **Remaining limitation, since resolved.** Two fills written in the same millisecond could still tie. Migration `20261113090000_trading_event_sequence` (Phase 3 safety work, applied with approval) adds a per-portfolio `sequence` to orders, executions and cash entries. Histories are now ordered by financial time, then `sequence`; `recordedAt` is audit only. See [trading README §4](../trading/README.md).

**Two display fixes in the Monte Carlo Lab came out of the screenshots.** Interval hints may now wrap, but only at the dash between the two bounds. Before, the risk table was wider than its panel at desktop width and the last column was cut off.

### 6.7 Benchmarks and statistical calibration (Phase 3 verification)

Script: `apps/api/src/scripts/actuarial-benchmark.ts`. Run it with `npm run build && npm run bench:actuarial` in `apps/api`.

- It runs the compiled engine, so runs go through the real worker threads. It uses no database and no network.
- **Machine:** Node v22.23.1, Intel Core i5-9300H (8 logical cores), 32 GB RAM. Run on 9 Nov 2026.
- Timings vary from machine to machine. The statistical results depend only on the seeds.

**Reproducibility** (10,000 simulations; SHA-256 of the full JSON result):

- For all three presets, two runs with seed 20261109 gave identical results.
- A worker-thread run gave the same result as the in-process run.
- Seed 20261110 gave a different result.

**Run time.** In-process times are the median of 3 runs; worker times are a single run, including thread start-up. The last column is the simulated mean's distance from the exact mean, in standard errors.

| Preset | Simulations | Lognormal draws | In-process | Worker thread | Mean vs exact |
| --- | ---: | ---: | ---: | ---: | ---: |
| reference-deterministic | 10,000 | n/a | 28 ms | 174 ms | −0.34 |
| reference-deterministic | 200,000 | n/a | 282 ms | 323 ms | 1.03 |
| motor-gamma | 10,000 | n/a | 24 ms | 102 ms | −0.06 |
| motor-gamma | 200,000 | n/a | 138 ms | 241 ms | 0.50 |
| home-lognormal | 10,000 | 2.4 M | 233 ms | 460 ms | 1.34 |
| home-lognormal | 83,000 (draw limit) | 19.9 M | 1,405 ms | 1,617 ms | −0.91 |

**Large portfolios** (200,000 simulations each):

| Portfolio | Claims per period | Run time | Mean vs exact | Comparison with an exact value |
| --- | ---: | ---: | ---: | --- |
| Binomial, 1,000,000 policies, p = 5%, gamma cost | 50,000 | 802 ms | 0.88 standard errors | None: Panjer underflows and the API reports it |
| Poisson, 2,000,000 policies, rate 0.08, gamma cost | 160,000 | 206 ms | 0.36 standard errors | None: Panjer underflows and the API reports it |
| Binomial, 1,000,000 policies, p = 5%, fixed cost | 50,000 | 643 ms | 0.28 standard errors | VaR 99.5%: simulated 60,676,800, exact 60,674,400 |

Claim counts are drawn exactly, never claim by claim, so run time does not grow with the portfolio for fixed or gamma claim costs.

**Interval coverage.** 400 independent runs of 5,000 simulations each, seeds 1–400. A calibrated 95% interval covers the exact value in about 95% of runs; with 400 runs, that share has a standard error of about 1.1 points.

| Preset | Mean | VaR 99% | P(S > exact VaR 95%), Wilson interval |
| --- | ---: | ---: | ---: |
| reference-deterministic | 95.0% | 99.8% | 95.8% |
| motor-gamma | 95.3% | 95.8% | 95.5% |

The 99.8% for the fixed-cost VaR is expected. That distribution is discrete, so order-statistic intervals are conservative.

**Capacity.** 9 simultaneous 200,000-simulation motor runs gave:

- 8 completed and 1 was refused with `SIMULATION_BUSY` capacity (2 running plus 6 waiting is the limit);
- wall time 1.3 s;
- event-loop delay p99 17.4 ms, maximum 19.4 ms, so the API stayed responsive during the runs.

**What this does not cover.** The figures above are measured. The following are covered elsewhere:

- persistence, ownership and authentication: `test/actuarial-simulation.e2e-spec.ts`;
- screen rendering: the browser journey in §6.5.

## 7. Phase 3: claims reserving

### 7.1 Hand example

A 3 × 3 triangle, small enough to check on paper. Paid \(\{100, 150, 165\}, \{120, 186\}, \{130\}\); incurred \(\{160, 170, 168\}, \{190, 210\}, \{200\}\); premiums 200, 220, 240; expected loss ratio 80%; no tail.

| Quantity | By hand | API |
| --- | --- | --- |
| Paid factors (volume-weighted) | \(336/220 = 1.527273\); \(165/150 = 1.1\) | 1.527273; 1.1 |
| Simple average 1→2; latest calendar year only | \((1.5 + 1.55)/2 = 1.525\); 1.55 | 1.525; 1.55 |
| Paid CDFs | \(1.527273 \times 1.1 = 1.68\); 1.1; 1 | 1.68; 1.1; 1 |
| Paid CL ultimates | 165; \(186 \times 1.1 = 204.6\); \(130 \times 1.68 = 218.4\); total 588 | 165; 204.6; 218.4; 588 |
| Paid to date, incurred, case reserves | 481; 578; \(3 + 24 + 70 = 97\) | 481; 578; 97 |
| Paid CL unpaid \(= U - P\) | \(0 + 18.6 + 88.4 = 107\) | 107 |
| Paid CL IBNR \(= U - I\) | \(-3 - 5.4 + 18.4 = 10\); check \(107 = 97 + 10\) | 10; reconciliation holds |
| Incurred factors; incurred CL ultimate | \(380/350\), \(168/170\); \(168 + 207.53 + 214.59 = 590.12\) | same; 590.118 |
| Expected loss ratio ultimates | \(0.8 \times (200, 220, 240) = 160, 176, 192\) | 160; 176; 192 (total 528) |
| BF paid, year 2025 | \(130 + 192 \times (1 - 1/1.68) = 207.71\) | 207.71 (total 575) |
| BF as a blend | \(Z \cdot U^{CL} + (1-Z) U^{ELR}\), \(Z = 1/\mathrm{CDF}\) | Equal for every year (unit test) |
| Expected payments 2026, 2027 | \(18.6 + 130 \times 1.527273 - 130 = 87.145\); \(218.4 - 198.545 = 19.855\) | 87.145; 19.855 (total 107) |
| 1% shock to factor 1→2 | Only 2025 passes through it: \(0.01 \times 218.4 = 2.184\) | 2.184 |
| Selected factor 1.6 for 1→2 | \(165 + 204.6 + 130 \times 1.6 \times 1.1 = 598.4\) | 598 shown |

The 2025 row is used here because the browser journey types the triangle with first accident year 2023. The unit test uses 2020, which changes only the labels.

### 7.2 Published benchmark

The Taylor & Ashe (1983) paid triangle, as used by Mack (1993), volume-weighted, no tail:

| Quantity | Published | API |
| --- | --- | --- |
| Development factors | 3.4906, 1.7473, 1.4574, 1.1739, 1.1038, 1.0863, 1.0539, 1.0766, 1.0177 | Equal to 4 decimals |
| Reserves by accident year | 0; 94,634; 469,511; 709,638; 984,889; 1,419,459; 2,177,641; 3,920,301; 4,278,972; 4,625,811 | Each within 1 |
| Total reserve | 18,680,856 | 18,680,856 (rounded) |

### 7.3 Missing amounts and undefined factors

Four years, with the 2021 development-year-2 amount missing: \(\{100, 150, 165, 170\}, \{120, -, 200\}, \{130, 190\}, \{140\}\).

- Factor 1→2 uses 2020 and 2022 only: \(340/230 = 1.478261\), from 2 pairs. Reading the gap as zero would give \(340/350 = 0.971\).
- Factor 2→3 uses 2020 only: \(165/150 = 1.1\). The 2021 year-3 amount (200) is not paired with the missing one.
- The 2021 link ratios are shown blank; the projection of 2021 starts from 200. The warnings `PAID_MISSING_CELLS` and `PAID_SINGLE_PAIR` are reported.
- A missing **latest** amount is refused (`422`, "the latest paid amount of accident year 2021").
- \(\{0, 0, 10\}, \{0, 5\}, \{7\}\) leaves factor 1→2 undefined (all bases zero): `422 FACTOR_UNDEFINED`. With selected factors 2 and 1.5, the same triangle is accepted.

### 7.4 The fictional examples

Computed by the API (whole dinars). All five methods are available for each.

| Example | Paid | Case reserves | CL paid ultimate / unpaid | CL incurred ultimate | Paid-tail payments with no timing |
| --- | ---: | ---: | ---: | ---: | ---: |
| Motor own damage, 2016–2025 | 59,685,859 | 5,947,131 | 66,503,760 / 6,817,901 | 66,562,842 | 0 |
| General liability, 2016–2025 (paid tail 1.02) | 28,146,647 | 11,437,497 | 42,359,034 / 14,212,387 | 43,830,703 | 830,569 |
| Small book with data issues, 2020–2025 | 7,427,905 | 948,920 | 8,659,652 / 1,231,747 | 8,756,220 | 0 |

A unit test checks that the motor and liability examples are coherent: incurred is never below paid, and neither chain ladder projects any year below its paid amount. The liability book's paid chain ladder runs 3.4% below its incurred chain ladder, as its description says (strengthened case reserves). The data-issues example is meant to trigger warnings: a missing amount, a recovery (2020, development year 6), and a paid chain-ladder ultimate below paid for 2021, the year projected through the factor that the recovery pulls below 1.

### 7.5 Automated tests

**API unit tests, `models/reserving.spec.ts`: 22 tests, all pass** (86 actuarial unit tests in all):

- the hand example: factors, CDFs, ultimates, unpaid, case reserves, IBNR and reconciliation; the projected triangle and payments by calendar year; the incurred chain ladder computed separately, with the paid-against-incurred comparison; the expected loss ratio and BF; BF as the credibility blend; simple and latest-diagonal averages;
- the Taylor & Ashe factors and reserves (§7.2);
- missing cells excluded, never zero; undefined factors refused and selectable; structure and parameter validation with messages naming the year;
- properties: repeatable; scale invariant (amounts × 1,000 leave the factors unchanged and multiply every reserve by 1,000); a tail factor scales every chain-ladder ultimate by the same ratio; a 1% factor shock moves exactly the years still projected through that factor; the payments add up to the paid chain-ladder unpaid for every example;
- the examples: valid, fictional, every method available; the liability paid tail is needed and its removal is flagged; the clean examples are coherent (§7.4); the data-issues warnings; the sensitivity scenarios, base first, with their changes.

**API end-to-end, `test/actuarial-reserving.e2e-spec.ts` on `PIF_test`: 4 tests, all pass:**

| Test | Proves |
| --- | --- |
| Requires authentication | `401` on all six reserving endpoints without a token |
| Examples and exact analyses | Three fictional examples and five methods; the hand triangle over HTTP (factors, unpaid 107, reserves totals, reconciliation, payments 107); the Taylor & Ashe total 18,680,856 with the incurred method reported unavailable; every example analyses with all methods |
| Validation | `400` for client-supplied results, a premium sent as text, an accident year before 1950, an unknown average, `LATEST_DIAGONALS` without a count, a tail of 9. `422 INVALID_TRIANGLE` for a row of the wrong length, a non-numeric amount and a missing latest amount, each naming the year. `422 FACTOR_UNDEFINED` for zero bases, accepted once factors are selected. The missing-cell factor is 340/230 |
| Runs | Client-supplied results refused; a stored run has server results, the full assumptions and a SHA-256 checksum, equal for identical data; another user gets `404` on read and delete and an empty list; malformed id `400`. With 26 runs on record, one more removes the two oldest (27 → 25); the newest is listed first; a run from model version 0.9.0 is `stale`; summaries carry no `results`; the overview reports 25 of 25 and the workspace as available; delete `204`, then `404` |

**Web (Vitest):**

| File | Tests | Proves |
| --- | --- | --- |
| `components/actuarial/reservingForm.test.ts` | 4 | Spaces, tabs, semicolons and grouped thousands are read; a dash or an empty tab cell is missing, never zero; text and empty pastes are refused; stored inputs round-trip into the same request; out-of-range assumptions are flagged and selections are dropped when the triangle changes size |
| `components/actuarial/ReservingStudio.test.tsx` | 5 | The example is sent to the server and only the returned figures are shown (KPIs from a fixture produced by the engine); pasted triangles keep missing amounts as `null` and a `422` is shown; a selected factor is sent and its range checked locally; save, load and delete; the "migration not applied" message |
| `components/actuarial/PricingStudio.test.tsx` | 3 | The Reserving Studio tab links to `/actuarial/reserving`; the ALM Lab stays disabled |

### 7.6 Browser journey

`npm run test:e2e:actuarial` against production builds, with the API on `PIF_test`: **75 of 75 checks pass** (56 from Phases 1 and 2, 19 new). The script computes every expected figure itself, with its own volume-weighted chain ladder written independently of the API:

16. **Motor example.** The paid chain ladder shown (ultimate 66,503,760, unpaid 6,817,901) equals the script's own calculation from the triangle read off the page, to the dinar. The payments by calendar year add up to the same unpaid; reconciliation is reported; five methods are compared; the completed triangle shades the 45 projected cells.
17. **Hand triangle typed in:** chain ladder paid 588, chain ladder incurred 590, expected loss ratio 528, BF paid 575 (all computed in the script); unpaid 107 = case reserves 97 + IBNR 10.
18. **A selected factor of 1.6** for years 1–2 gives a chain-ladder ultimate of 598, and the factor table marks the selection.
19. **Data-issues example:** the missing amount is shown as missing, and the checks explain that it is not treated as zero and that paid decreased (recoveries).
20. **Errors:** a non-numeric amount is caught before any request ("Line 1, amount 3: “abc” is not a number"); a missing latest amount is refused by the server, and earlier results are marked as belonging to earlier inputs.
21. **Runs:** saved and listed with the server's unpaid; listed on the overview; loading restores the assumptions and stored results; accessibility (inputs and factor cells labelled, live status, captions, chart descriptions); deleted after confirmation.

No horizontal page overflow at 1440, 768 and 375 px, and no uncaught page errors.

**Screenshots** in `docs/actuarial/screenshots/`:

| Page or panel | File |
| --- | --- |
| Reserving Studio, motor example | `A05-reserving-motor-{desktop,tablet,mobile}.png` |
| Completed triangle | `A05a-triangle-completed.png`, mobile `A05f-triangle-mobile.png` |
| Development factors | `A05b-development-factors.png`; with a selection `A05h-selected-factor.png` |
| Reserves by accident year | `A05c-reserves-by-year.png` |
| Sensitivity | `A05d-sensitivity.png` |
| Expected payments | `A05e-cash-flows.png` |
| Data entry, mobile | `A05g-data-entry-mobile.png` |
| Data checks (data-issues example) | `A05i-data-checks.png` |

### 7.7 Regression of the whole platform (Phase 3)

| Suite | Result |
| --- | --- |
| API unit tests (all modules) | 585 / 585 in 37 suites |
| API e2e: auth, email flows, learning, trading, actuarial, Monte Carlo, reserving (`PIF_test`) | 48 / 48 in 7 suites |
| API `tsc --noEmit` and ESLint | Clean |
| Web Vitest (all) | 148 / 148 in 27 files |
| Web `tsc --noEmit` and ESLint | Clean |
| API and web production builds | Succeed |
| Actuarial browser journey | 75 / 75 |
| Trading browser journey | 50 / 50 |
| Learning browser journey | 77 / 77 |

**A stale build found while writing this section.** The API build used for the first journey run was 15 seconds older than the last edit of `reserving-examples.ts`, which changed the liability example's incurred triangle. The unit and e2e tests compile from source and were unaffected. The motor example, the hand triangle and the screenshots do not use that triangle. The API was rebuilt and the actuarial journey rerun: 75 of 75.
