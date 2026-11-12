# Actuarial Lab: mathematical models (Phases 1 to 3)

Model version `pif-actuarial-1.0.0`; Monte Carlo engine `pif-actuarial-mc-1.0.0` (section 7); reserving model `pif-reserving-1.0.0` (section 8). Currency: TND, reported to the millime (0.001 DT).

**Notation:**

| Symbol | Meaning |
| --- | --- |
| \(n\) | Number of policies in force |
| \(t\) | Cover period in years |
| \(N\) | Number of claims for the whole portfolio in the period |
| \(X\) | Cost of one claim, after inflation |
| \(S = X_1 + \dots + X_N\) | Total (aggregate) claims |

Claim costs are independent and identically distributed, and independent of \(N\). This is the collective risk model.

**Input conventions.** Rates are entered as ratios in the API (0.05 = 5%) and as percentages in the web form. Claim costs are described by their **arithmetic mean** \(m\) and **coefficient of variation** \(c = \mathrm{sd}(X)/m\), which are the quantities an actuary reads from claims data. Distribution parameters are derived from them.

## 1. Claim frequency (`models/frequency.ts`)

### Binomial: at most one claim per policy in the period

The annual claim probability \(p\) is converted to the period, and each of the \(n\) policies claims independently:

\[ p_t = 1 - (1-p)^t, \qquad N \sim \mathrm{Bin}(n, p_t) \]

\[ E[N] = n\,p_t, \qquad \mathrm{Var}(N) = n\,p_t\,(1-p_t), \qquad P(N=k) = \binom{n}{k} p_t^k (1-p_t)^{n-k} \]

The probability mass function is evaluated in logs, with \(\ln\binom{n}{k}\) from the log-gamma function.

### Poisson: claims arrive at intensity \(\mu\) per policy-year

\[ \lambda = n\,t\,\mu, \qquad N \sim \mathrm{Poi}(\lambda), \qquad E[N] = \mathrm{Var}(N) = \lambda, \qquad P(N=k) = e^{-\lambda}\lambda^k/k! \]

The probability that a given policy has at least one claim is \(1 - e^{-\mu t}\).

### Reported figures

- \(E[N]\), \(\mathrm{Var}(N)\), \(\mathrm{sd}(N)\).
- Dispersion index \(\mathrm{Var}(N)/E[N]\): exactly 1 for Poisson, \(1 - p_t\) for Binomial.
- \(P(N = 0)\).
- \(P(N > E[N])\).
- Quantiles at 50, 75, 90, 95, 99 and 99.5%.
- The probability table.

The table covers \(E[N] \pm 9\,\mathrm{sd} + 12\) and reports the mass it covers. It is used for quantiles and charts up to \(E[N] = 200{,}000\).

**Not implemented: Negative Binomial.** Over-dispersion, \(\mathrm{Var}(N) > E[N]\), is the usual reason to use it. It will be added only with a concrete use case, such as heterogeneous risks in the reserving or capital phases.

### Panjer class

Both laws belong to the \((a, b, 0)\) class, which the aggregate recursion uses:

\[ P(N=k) = \left(a + \frac{b}{k}\right) P(N=k-1) \]

| Law | \(a\) | \(b\) | Probability generating function \(P_N(z)\) |
| --- | --- | --- | --- |
| Binomial | \(-p_t/(1-p_t)\) | \((n+1)\,p_t/(1-p_t)\) | \((1 - p_t + p_t z)^n\) |
| Poisson | \(0\) | \(\lambda\) | \(e^{\lambda(z-1)}\) |

## 2. Claim severity (`models/severity.ts`)

**No normal distribution.** Claim costs are positive and right-skewed. A normal model would give negative costs and understate large claims.

### Inflation

The cost data are inflated to the cover period with \(\tau = (1+i)^{y}\). Here \(i\) is the annual claim inflation rate (−5% to 30%) and \(y\) the trend period in years. The model uses \(m\,\tau\) as the mean. The coefficient of variation is unchanged, so every claim scales by \(\tau\).

### The three laws

| Law | Parameters from \((m, c)\) | \(E[X]\) | \(\mathrm{Var}(X)\) |
| --- | --- | --- | --- |
| Deterministic | \(X = m\) | \(m\) | \(0\) |
| Gamma | shape \(k = 1/c^2\), scale \(\theta = m c^2\) | \(k\theta = m\) | \(k\theta^2 = (cm)^2\) |
| Lognormal | \(\sigma^2 = \ln(1 + c^2)\), \(\mu = \ln m - \sigma^2/2\) | \(e^{\mu + \sigma^2/2} = m\) | \(m^2(e^{\sigma^2} - 1) = (cm)^2\) |

**Lognormal parameters.** \(\mu\) and \(\sigma\) are the mean and standard deviation of \(\ln X\), **not** of the claim cost. The median is \(e^{\mu} = m/\sqrt{1+c^2}\), below the mean. The API returns them as `parameters.mu` and `parameters.sigma`, and the web labels them "μ, σ of ln X".

### Distribution functions

| Law | CDF \(F(x)\) | Quantile |
| --- | --- | --- |
| Gamma | \(P(k, x/\theta)\), the regularized lower incomplete gamma function | Bracketing from the mean, then bisection on the CDF |
| Lognormal | \(\Phi\big((\ln x - \mu)/\sigma\big)\) | \(e^{\mu + \sigma\,\Phi^{-1}(q)}\) |

### Limited expected value

\(E[X \wedge d] = E[\min(X, d)]\) is used by the discretisation in section 3:

| Law | \(E[X \wedge d]\) |
| --- | --- |
| Deterministic | \(\min(m, d)\) |
| Gamma | \(m\,P(k+1, d/\theta) + d\,\big(1 - P(k, d/\theta)\big)\) |
| Lognormal | \(m\,\Phi(z - \sigma) + d\,\Phi(-z)\), where \(z = (\ln d - \mu)/\sigma\) |

### Reported figures

- Mean, sd, coefficient of variation.
- Derived parameters.
- Quantiles.
- **Tail ratio** \(q_{99.5\%}/m\): how many average claims a 1-in-200 claim costs.
- \(P(X > \text{threshold})\).
- A 101-point density curve up to the 99.5% quantile. It is absent for the deterministic law, which has no density.

## 3. Aggregate loss (`models/aggregate.ts`)

### Moments (exact, always available)

\[ E[S] = E[N]\,E[X], \qquad \mathrm{Var}(S) = E[N]\,\mathrm{Var}(X) + \mathrm{Var}(N)\,E[X]^2 \]

### Distribution

**Exact (deterministic cost).** \(S = m\,N\), so \(P(S = m k) = P(N = k)\). There is no approximation.

**Panjer recursion (gamma and lognormal costs).** The severity is placed on a grid \(0, h, 2h, \dots, Mh\), with \(M = 4096\) and an upper bound

\[ U = \max\big(E[S] + 12\,\mathrm{sd}(S),\ q_X(0.9999)\big), \qquad h = U/M. \]

**Discretisation.** The masses come from **mean-preserving local moment matching**:

\[ x_0 = 1 - \frac{E[X \wedge h]}{h}, \qquad x_j = \frac{2E[X \wedge jh] - E[X \wedge (j-1)h] - E[X \wedge (j+1)h]}{h}. \]

This keeps \(E[X]\) exact. Plain rounding to the nearest grid point was tried first and rejected: for the lognormal preset, where \(h\) is comparable to the median claim, it understated \(E[S]\) by 4.5%.

**Recursion.** The compound distribution follows from the recursion:

\[ f_0 = P_N(x_0), \qquad f_k = \frac{1}{1 - a\,x_0}\sum_{j=1}^{k}\left(a + \frac{b\,j}{k}\right) x_j\, f_{k-j}. \]

**Tail mass.** If the captured mass \(\sum f_k\) is below \(1 - 10^{-7}\), \(U\) is doubled. This is repeated up to 4 times.

**When the exact method is unavailable.** When \(\ln f_0 < -700\), \(f_0\) underflows double precision. This happens from roughly 700 expected claims for Poisson. The distribution is then reported as **unavailable, with the reason**, and VaR, TVaR and probabilities are `null`. The moments stay valid. The Monte Carlo Lab (section 7) estimates these figures for such portfolios.

### Risk measures on the lattice

| Measure | Definition |
| --- | --- |
| \(\mathrm{VaR}_\alpha\) | Smallest lattice value \(s\) with \(P(S \le s) \ge \alpha\). Null if \(\alpha\) lies in the uncaptured mass |
| \(\mathrm{TVaR}_\alpha\) | \(\big(E[S\,\mathbf 1\{S > \mathrm{VaR}\}] + \mathrm{VaR}\,(P(S \le \mathrm{VaR}) - \alpha)\big)/(1-\alpha)\). This is the exact expected shortfall for a discrete law. Null if the uncaptured mass exceeds \(10^{-4}(1-\alpha)\) |
| \(P(S > s)\) | Sum of lattice masses above \(s\), **plus** the uncaptured mass. It is an upper bound, conservative by at most \(1 - \sum f_k\) |
| Normal approximation | \(E[S] + \mathrm{sd}(S)\,\Phi^{-1}(\alpha)\). Shown for comparison only; it understates skewed totals |

Risk levels: 90, 95, 99 and 99.5%. The histogram groups the lattice between its 0.05% and 99.95% quantiles into at most 60 bins.

## 4. Premium (`models/pricing.ts`)

**Risk loading.** Two principles are offered:

| Principle | Loading | Allowed parameter |
| --- | --- | --- |
| Expected value | \(RL = \theta\,E[S]\) | \(0 \le \theta \le 1\) |
| Standard deviation | \(RL = k\,\mathrm{sd}(S)\) | \(0 \le k \le 5\) |
| None | \(RL = 0\) | — |

**Fixed expenses.** \(F = \text{fixed} + \text{perPolicy}\cdot n\).

**Premium build-up.**

\[ \text{pure premium} = E[S], \qquad P_T = E[S] + RL + F \quad\text{(technical premium)} \]

Variable expenses \(v\) (commissions, premium taxes) and the profit margin \(m\) are **shares of the gross premium itself**. The gross premium is therefore solved for, not added up:

\[ P_G = v\,P_G + m\,P_G + P_T \;\Rightarrow\; P_G = \frac{P_T}{1 - v - m}, \qquad v + m < 1. \]

For the reference portfolio (\(v = m = 0\)), this is the master prompt's \(P = (E[S] + \text{loadings})/(1 - v - m)\), with the fixed expenses included in the loadings.

**Derived figures:**

| Figure | Formula |
| --- | --- |
| Variable expenses | \(v\,P_G\) |
| Profit margin | \(m\,P_G\) |
| Claims budget (premium left for claims after all expenses) | \(B = P_G - F - v\,P_G\) |
| Expected underwriting result | \(P_G - E[S] - F - v P_G = RL + m P_G\) |
| Loss ratio | \(E[S]/P_G\) |
| Expense ratio | \((F + vP_G)/P_G\) |
| Combined ratio | Loss ratio + expense ratio |
| Underwriting margin | Expected result \(/ P_G\) |

Per-policy figures divide by \(n\). The pure premium per exposure divides by \(n\,t\) (policy-years).

**Probabilities from the loss distribution:**

| Probability | Event |
| --- | --- |
| \(P(S > B)\) | Probability of an underwriting loss in the period |
| \(P(S > P_G)\) | Claims alone exceed all the premium collected |

**Sensitivities (one at a time).** Each driver is shocked, the book is repriced, and two figures are reported:

- the repriced gross premium and its change;
- the expected underwriting result if the shock happens but the base premium is kept: \(P_G^{\text{base}} - E[S'] - F' - v' P_G^{\text{base}}\).

Shocks:

- frequency +10%;
- average claim cost +10%;
- fixed and per-policy expenses +10%;
- variable expense rate +1 point;
- risk-loading parameter +10%.

**Out of scope in Phase 1:**

- investment income on premiums and reserves (Phase 4, ALM);
- reinsurance;
- the cost of capital (Phase 3);
- policy-level rating factors (the premium is a portfolio average);
- deductibles and limits;
- claim-settlement delay (Phase 3, reserving).

## 5. Numerical methods (`math/special.ts`)

| Function | Method | Checked against |
| --- | --- | --- |
| \(\ln\Gamma(x)\) | Lanczos (g = 7, 9 coefficients) with reflection | \(\ln (n-1)!\); \(\Gamma(1/2) = \sqrt\pi\); \(\ln\Gamma(170)\) |
| \(P(a, x)\), \(Q(a, x)\) | Series for \(x < a+1\), Lentz continued fraction otherwise | Closed forms for integer shapes: \(Q(n, x) = e^{-x}\sum_{k<n} x^k/k!\) |
| \(\Phi(z)\) | \(\tfrac12 Q(\tfrac12, z^2/2)\) for \(z < 0\), complement otherwise | Standard tables, including the tails |
| \(\Phi^{-1}(p)\) | Acklam's rational approximation plus one Halley refinement | Standard tables; round trip with \(\Phi\) |
| Generic quantile | Bracketing and bisection on a monotone CDF | Exponential quantile \(-\theta\ln(1-q)\) |

## 6. Reference dataset (master prompt §15)

1,000 policies, annual claim probability 5% (Binomial), every claim costs 1,200 TND, fixed expenses 20,000 TND, expected-value loading 15%, no variable expenses or margin.

| Quantity | Hand calculation | Model |
| --- | --- | --- |
| \(E[N]\) | \(1000 \times 0.05 = 50\) | 50 |
| \(E[S]\) | \(50 \times 1200 = 60{,}000\) | 60,000.000 |
| \(\mathrm{sd}(S)\) | \(1200\sqrt{1000 \times 0.05 \times 0.95} = 8{,}270.429\) | 8,270.429 |
| Risk loading | \(0.15 \times 60{,}000 = 9{,}000\) | 9,000.000 |
| Gross premium | \(60{,}000 + 9{,}000 + 20{,}000 = 89{,}000\) | 89,000.000 |
| Per policy | \(89{,}000 / 1000 = 89\) | 89.000 |
| Claims budget | \(89{,}000 - 20{,}000 = 69{,}000\) | 69,000.000 |
| \(P(\text{underwriting loss}) = P(N > 57.5) = P(N \ge 58)\) | Binomial(1000, 0.05) tail | 13.89% |

[validation.md](validation.md) gives the other presets and every automated check.

## 7. Monte Carlo simulation (`models/simulation.ts`, `models/sampling.ts`)

Engine version `pif-actuarial-mc-1.0.0`. The simulation uses **the same frequency, severity and premium model** as sections 1–4. It adds no new assumption; it estimates by sampling what sections 3 and 4 compute exactly, and it also covers portfolios for which the exact distribution is unavailable.

### Sampling one period

Each simulated period \(i = 1, \dots, n_{\text{sim}}\) draws a claim count \(N_i\), then the total cost \(S_i\):

| Claim cost | Draw of \(S_i\) given \(N_i = k\) | Why |
| --- | --- | --- |
| Deterministic | \(S_i = m\,k\) | Exact |
| Gamma, shape \(\kappa\), scale \(\theta\) | \(S_i = \theta\,G\) with \(G \sim \mathrm{Gamma}(k\kappa, 1)\) | A sum of \(k\) independent Gamma\((\kappa, \theta)\) costs is exactly Gamma\((k\kappa, \theta)\), so one draw replaces \(k\) |
| Lognormal \((\mu, \sigma)\) | \(S_i = \sum_{j=1}^{k} e^{\mu + \sigma Z_j}\), \(Z_j\) standard normal | A sum of lognormals has no closed form, so every claim is drawn |

**No normal approximation of counts.** The counts are drawn exactly, whatever the size of the portfolio:

- **Binomial \((n, p)\):** while \(n > 40\), the order statistic \(X \sim \mathrm{Beta}(a, n + 1 - a)\), \(a = 1 + \lfloor n/2 \rfloor\), splits the trials (Knuth, TAOCP vol. 2, §3.4.1). If \(X \ge p\), the successes are among the \(a - 1\) uniforms below \(X\), each with probability \(p/X\). Otherwise all \(a\) succeed and the \(n - a\) others succeed with probability \((p - X)/(1 - X)\). The last trials are drawn one by one.
- **Poisson \((\lambda)\):** while \(\lambda > 30\), the \(m\)-th arrival time \(X \sim \mathrm{Gamma}(m)\), \(m = \lfloor 7\lambda/8 \rfloor\), of a unit-rate Poisson process either falls beyond \(\lambda\) (then the count is Binomial\((m - 1, \lambda/X)\)) or accounts for \(m\) arrivals, leaving \(\lambda - X\). Small means use the multiplication method.
- **Gamma, shape \(\kappa\):** Marsaglia–Tsang (2000) for \(\kappa \ge 1\); for \(\kappa < 1\), \(G(\kappa + 1)\,U^{1/\kappa}\).
- **Beta \((a, b)\):** \(X/(X + Y)\) with independent gamma variates.

**Random numbers.** The shared generator in `apps/api/src/market-data/rng.ts`: mulberry32 (32-bit state) gives uniforms on \([0, 1)\), and Box–Muller turns pairs of uniforms into standard normals. The periods are drawn in a fixed order, so **the same assumptions, seed and engine version reproduce every figure exactly**. The seed is a whole number from 1 to 2,147,483,647. If the user gives none, the server draws one and returns it.

### Thresholds

With \(P\) the premium charged (the model's gross premium \(P_G\) unless the user enters another one), \(F\) the fixed expenses, \(v\) the variable expense rate and \(C\) the initial capital:

\[ B = P - F - vP \quad\text{(claims budget)}, \qquad B + C \quad\text{(capital threshold)}. \]

| Event | Meaning |
| --- | --- |
| \(S > B\) | Technical underwriting loss in the period |
| \(S > P\) | Claims alone exceed all the premium charged |
| \(S > B + C\) | The loss exceeds the initial capital: capital is insufficient at the end of the period |

Investment income, reinsurance and claim-settlement delay are not modelled (as in section 4), so "capital insufficient" here means a one-period technical shortfall. It is **not** a regulatory solvency measure.

### Estimators and their 95% intervals

The \(n\) simulated totals are sorted: \(S_{(1)} \le \dots \le S_{(n)}\). \(F_n\) is their empirical distribution function and \(z = 1.959964\).

| Quantity | Estimator | 95% interval |
| --- | --- | --- |
| \(E[S]\) | \(\bar S = \frac1n \sum S_i\) | \(\bar S \pm z\,s/\sqrt n\), \(s\) the sample standard deviation |
| sd, median, min, max, skewness | Sample values; skewness \(m_3/m_2^{3/2}\) with population moments | — |
| \(\mathrm{VaR}_\alpha\) | \(S_{(\lceil n\alpha \rceil)}\): the smallest simulated value with \(F_n \ge \alpha\), the same definition as the exact method | Order statistics \(S_{(\lfloor n\alpha - z\sqrt{n\alpha(1-\alpha)} \rfloor)}\) to \(S_{(\lceil n\alpha + z\sqrt{n\alpha(1-\alpha)} \rceil)}\), distribution-free |
| \(\mathrm{TVaR}_\alpha\) | \(\big(\frac1n\sum_{S_i > \mathrm{VaR}} S_i + \mathrm{VaR}\,(F_n(\mathrm{VaR}) - \alpha)\big)/(1 - \alpha)\), the discrete formula of section 3 | \(\pm z\sqrt{\big(\mathrm{Var}(S \mid S \ge \mathrm{VaR}) + \alpha(\mathrm{TVaR} - \mathrm{VaR})^2\big)/(n(1-\alpha))}\), asymptotic; omitted when fewer than 10 values lie in the tail |
| \(P(S > t)\) | Share of periods with \(S_i > t\). A total equal to \(t\) is not an exceedance | Wilson score interval. It stays in \([0, 1]\) and gives an informative upper bound when no period exceeds \(t\) |
| Expected shortfall beyond capital | \(\frac1n\sum \max(S_i - B - C, 0)\) | — |

Risk levels: 90, 95, 99 and 99.5%. About 1 interval in 20 misses the true value by chance alone, so a single miss is not evidence of an error. The screen says so.

### Comparison with the exact model

When the exact distribution of section 3 is available, the response puts the exact mean, VaR, TVaR and threshold probabilities beside the simulated ones. It also reports whether each exact value lies inside the simulated interval. The exact values come from the model, not from the simulation. They are labelled "closed form" for a fixed claim cost and "Panjer recursion" otherwise. When the exact distribution is unavailable, only the exact mean and sd are compared, and the reason is shown.

### Charts

- **Histogram:** from the minimum to the 99.9% quantile, in 60 bins. The periods beyond are counted in `above`, so no period is lost. With a fixed claim cost, each bin is a whole number of claims wide, so every bin holds the same number of possible totals.
- **Exceedance curve:** \(P(S > x)\), simulated and exact, at 41 points between the 0.1% and 99.9% quantiles.
- **Convergence:** at 40 checkpoints in simulation order, the running mean with its 95% interval and the running \(P(S > B)\). The last point equals the final estimate.

### Limits and execution

| Limit | Value | Reason |
| --- | --- | --- |
| Simulated periods | 1,000 – 200,000 | Below 1,000 the tail estimates are meaningless; above 200,000 the run time grows with no visible gain for teaching |
| Lognormal claim draws per run | \(n_{\text{sim}} \times E[N] \le 20{,}000{,}000\) | Lognormal claims are drawn one by one; the error message gives the largest run that fits |
| Seed | 1 – 2,147,483,647 | |

Runs execute in **worker threads**, never on the API's event loop. At most 2 run at once, 6 more may wait, and any further request is refused with `503 SIMULATION_BUSY`. A run that takes more than 30 seconds is stopped (`503 SIMULATION_TIMEOUT`). The individual simulated totals are discarded after the run. Only the inputs, seed, engine version, duration and the summarised results above are stored.

## 8. Claims reserving (`models/reserving.ts`)

Deterministic best estimates on **annual** development triangles. No variability measure (Mack, bootstrap), no discounting, no risk margin: these are not regulatory technical provisions.

### Triangles and the quantities reserved

Accident (origin) years \(i = 0, \dots, n-1\) are the rows, development years \(j = 1, \dots, n\) the columns, and \(C_{i,j}\) is the **cumulative** amount of accident year \(i\) at the end of its development year \(j\). Row \(i\) is observed up to development year \(n - i\). That cell lies on the latest diagonal, the valuation date (31 December of the latest accident year). \(3 \le n \le 25\).

Per accident year at the valuation date, each amount counted once:

| Quantity | Definition |
| --- | --- |
| Paid \(P_i\) | Latest cumulative paid amount |
| Reported (incurred) \(I_i\) | Latest cumulative incurred amount = paid + case reserves |
| Case reserve | \(I_i - P_i\): set claim by claim for reported claims |
| Ultimate \(U_i\) | Estimated total cost of the accident year, from one method |
| Unpaid (outstanding) | \(U_i - P_i\) = case reserve + IBNR |
| IBNR | \(U_i - I_i\): claims incurred but not reported, **plus** further development of known claims (IBNER). A triangle has no claim-level data, so the two are not separated |
| Development | \(U_i - \) latest amount on the basis used (paid or incurred) |

The reconciliation check recomputes, for every method and year, unpaid = \(U - P\) = case + IBNR, and every total = the sum of its years. It reports the largest relative difference. Negative IBNR is allowed (the method projects less than is already reported) and is shown, never hidden.

### Missing and invalid data

- A **missing** cell is `null`. It is excluded from every factor that needs it and is **never read as zero**. A warning lists the missing cells.
- The **latest** amount of every row is required: without it the reserve of that year cannot be estimated, and the request is refused (`422 INVALID_TRIANGLE`).
- Amounts must be finite, non-negative and at most \(10^{12}\). Rows must have exactly \(n - i\) amounts.
- A factor that no pair can estimate (all pairs missing, or all bases zero) is **not replaced silently**. The request is refused (`422 FACTOR_UNDEFINED`) until the user selects a factor for that period.

### Development factors

The individual link ratio is \(f_{i,j} = C_{i,j+1} / C_{i,j}\), defined when both amounts are observed and \(C_{i,j} > 0\). For each period \(j \to j+1\), over the accident years with both amounts:

| Average | Formula |
| --- | --- |
| Volume-weighted (default) | \(\hat f_j = \sum_i C_{i,j+1} / \sum_i C_{i,j}\) |
| Simple | Mean of the defined link ratios \(f_{i,j}\) |
| Latest \(k\) calendar years | Volume-weighted over the pairs whose later cell lies on one of the \(k\) latest diagonals: \(i + j + 1 \ge n - k\) (0-based \(j\)), \(1 \le k \le n - 1\) |

The minimum and maximum link ratios and the number of pairs are reported. A selected factor (0.1 to 100) replaces the estimate for its period; the response marks it `SELECTED`.

Cumulative development factor to ultimate from development year \(j\):

\[
\mathrm{CDF}_n = \text{tail}, \qquad \mathrm{CDF}_j = f_j \cdot \mathrm{CDF}_{j+1}, \qquad \%\text{developed}_j = 1 / \mathrm{CDF}_j .
\]

The tail factor (0.5 to 3; 1 means no development after year \(n\)) is set separately for paid and incurred.

### Methods

| Method | Ultimate \(U_i\) | Needs |
| --- | --- | --- |
| Chain ladder, paid | \(P_i \cdot \mathrm{CDF}^{\text{paid}}_{n-i}\) | Paid triangle |
| Chain ladder, incurred | \(I_i \cdot \mathrm{CDF}^{\text{inc}}_{n-i}\) | Incurred triangle |
| Expected loss ratio | \(\text{ELR} \cdot \text{EP}_i\) | Earned premiums, a priori loss ratio (0.01 to 5) |
| Bornhuetter–Ferguson, paid | \(P_i + \text{ELR} \cdot \text{EP}_i \,(1 - 1/\mathrm{CDF}^{\text{paid}}_{n-i})\) | Paid triangle, premiums, ELR |
| Bornhuetter–Ferguson, incurred | \(I_i + \text{ELR} \cdot \text{EP}_i \,(1 - 1/\mathrm{CDF}^{\text{inc}}_{n-i})\) | Incurred triangle, premiums, ELR |

Bornhuetter–Ferguson is the credibility blend \(Z \cdot U^{\text{CL}} + (1 - Z) \cdot U^{\text{ELR}}\) with \(Z = 1/\mathrm{CDF}\); a unit test checks this identity. A method whose inputs are missing is returned as unavailable with its reason, never as zero.

The projected lower triangle multiplies the latest amount by the selected factors in turn; observed cells are returned as given (missing ones stay `null`). Paid and incurred chain ladders are computed independently, and their ultimates are compared by accident year.

### Sensitivity

The analysis is recomputed with one assumption changed at a time, and the total unpaid of every method is returned with its change from the base:

- the other factor averages (volume-weighted, simple, latest 3 calendar years);
- both tail factors \(+0.05\);
- the expected loss ratio \(\pm 10\%\) (relative), when premiums are given.

A scenario that cannot be computed (for example, a factor that becomes undefined) is listed with the reason. Separately, each selected factor is raised by 1% alone. Because amounts to date do not change, the change in chain-ladder unpaid equals the change in ultimate: \(0.01 \times \sum_{i:\,n-i \le j} U_i\), the ultimates of the years still projected through that factor.

### Expected payments (liability cash flows)

From the projected paid triangle, the expected payment in calendar year \(v + t\) (\(v\) = valuation year, \(t = 1, \dots, n-1\)) is the sum of the projected incremental paid amounts on that future diagonal. The payments after development year \(n\), \(\sum_i C_{i,n}(\text{tail} - 1)\), are reported as one amount with **no timing**. Their total equals the paid chain-ladder unpaid. The amounts are **undiscounted**, with no inflation adjustment and no risk margin. They are the liability input for the planned ALM Lab (see [architecture §9](architecture.md#9-the-alm-interface)).

### Warnings

| Code | When |
| --- | --- |
| `PAID_MISSING_CELLS`, `INCURRED_MISSING_CELLS` | Missing amounts, listed |
| `PAID_ZERO_BASE`, `INCURRED_ZERO_BASE` | A zero amount followed by a positive one: its link ratio is undefined |
| `PAID_SINGLE_PAIR`, `INCURRED_SINGLE_PAIR` | An estimated factor rests on a single accident year |
| `PAID_SELECTION_FAR`, `INCURRED_SELECTION_FAR` | A selected factor differs from its estimate by more than 25% |
| `PAID_TAIL`, `INCURRED_TAIL` | The last factor exceeds 1.005 but the tail factor is 1 |
| `PAID_DECREASES` | Cumulative paid falls (recoveries, or a data error) |
| `NEGATIVE_CASE_RESERVE` | Incurred below paid in some cell |
| `<METHOD>_NEGATIVE_UNPAID` | A method projects an ultimate below the amount already paid |
| `PAID_INCURRED_GAP` | Paid and incurred chain-ladder ultimates differ by more than 5% |
| `LOSS_RATIO_UNUSED` | A loss ratio without premiums |
