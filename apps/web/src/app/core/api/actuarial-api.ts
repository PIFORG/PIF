import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

/**
 * Types and endpoints of apps/web/src/lib/api/actuarial.ts. Amounts are TND (DT) to the millime; probabilities, rates and
 * ratios are fractions (0.05 = 5%). Every figure is a model estimate from fictional assumptions, computed by the server.
 */
export type FrequencyFamily = 'BINOMIAL' | 'POISSON';
export type SeverityFamily = 'DETERMINISTIC' | 'GAMMA' | 'LOGNORMAL';
export type RiskLoadingMethod = 'NONE' | 'EXPECTED_VALUE' | 'STANDARD_DEVIATION';

export interface PricingAssumptions {
  frequency: { family: FrequencyFamily; policies: number; years: number; probability?: number; intensity?: number };
  severity: { family: SeverityFamily; mean: number; cv?: number };
  inflation: { annualRate: number; years: number };
  expenses: { fixed: number; perPolicy: number; variableRate: number };
  profitMarginRate: number;
  riskLoading: { method: RiskLoadingMethod; parameter: number };
}

export interface ActuarialProvenance {
  kind: 'ESTIMATED';
  basis: string;
  modelVersion: string;
  currency: string;
}

export interface Bins {
  from: number;
  binWidth: number;
  probabilities: number[];
}

export interface FrequencyResult {
  family: FrequencyFamily;
  policies: number;
  years: number;
  exposure: number;
  parameters: Record<string, number>;
  mean: number;
  variance: number;
  sd: number;
  dispersionIndex: number | null;
  probabilityNoClaim: number;
  probabilityPolicyClaims: number;
  quantiles: { level: number; value: number }[];
  probabilityAboveMean: number;
  distribution: Bins;
}

export interface SeverityResult {
  family: SeverityFamily;
  mean: number;
  variance: number;
  sd: number;
  cv: number;
  parameters: Record<string, number>;
  quantiles: { level: number; value: number }[];
  tailRatio: number;
  exceedance: { threshold: number; probability: number }[];
  curve: { x: number; density: number }[] | null;
}

export interface AggregateResult {
  mean: number;
  variance: number;
  sd: number;
  cv: number | null;
  distribution:
    | { available: true; method: 'EXACT' | 'PANJER'; span: number; capturedMass: number; latticeMean: number }
    | { available: false; reason: string };
  risk: { level: number; valueAtRisk: number | null; tailValueAtRisk: number | null; normalApproximation: number }[];
  exceedance: { threshold: number; probability: number | null }[];
  histogram: Bins | null;
}

export interface PremiumLines {
  purePremium: number;
  riskLoading: number;
  fixedExpenses: number;
  technicalPremium: number;
  variableExpenses: number;
  profitMargin: number;
  grossPremium: number;
}

export interface PricingResult {
  provenance: ActuarialProvenance;
  assumptions: PricingAssumptions;
  trendFactor: number;
  frequency: FrequencyResult;
  severity: SeverityResult;
  aggregate: AggregateResult;
  premium: {
    totals: PremiumLines & { expectedUnderwritingResult: number; claimsBudget: number };
    perPolicy: PremiumLines;
    purePremiumPerExposure: number;
    ratios: { loss: number; expense: number; combined: number };
    underwritingMargin: number | null;
  };
  probabilities: { underwritingLoss: number | null; claimsExceedPremium: number | null };
  sensitivities: {
    driver: string;
    label: string;
    repricedGrossPremium: number;
    repricedPerPolicy: number;
    premiumChange: number;
    resultAtBasePremium: number;
  }[];
  warnings: string[];
}

export interface ScenarioHeadline {
  grossPremium: number;
  grossPremiumPerPolicy: number;
  expectedClaims: number;
  combinedRatio: number;
  probabilityOfUnderwritingLoss: number | null;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  kind: 'PRICING';
  modelVersion: string;
  currency: string;
  stale: boolean;
  headline: ScenarioHeadline;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioDetail extends ScenarioSummary {
  inputs: PricingAssumptions;
  results: PricingResult;
}

export interface ActuarialPreset {
  id: string;
  name: string;
  description: string;
  provenance: 'FICTIONAL';
  assumptions: PricingAssumptions;
  headline: ScenarioHeadline;
}

export interface Interval {
  lower: number;
  upper: number;
}

/** A simulated estimate next to the exact model value, when the exact distribution is available. */
export interface SimulatedProbability {
  simulated: number;
  interval: Interval;
  exact: number | null;
  withinInterval: boolean | null;
  count: number;
}

export interface SimulationResult {
  provenance: { kind: 'SIMULATED'; basis: string; modelVersion: string; currency: string };
  engineVersion: string;
  rng: string;
  seed: number;
  simulations: number;
  thresholds: {
    premiumCharged: number;
    premiumSource: 'MODEL' | 'USER';
    modelGrossPremium: number;
    fixedExpenses: number;
    variableExpenses: number;
    claimsBudget: number;
    initialCapital: number;
    capitalThreshold: number;
  };
  claimCount: { mean: number; analyticMean: number; max: number };
  statistics: { mean: number; meanInterval: Interval; sd: number; median: number; min: number; max: number; skewness: number | null };
  risk: {
    level: number;
    valueAtRisk: number;
    valueAtRiskInterval: Interval;
    tailValueAtRisk: number;
    tailValueAtRiskInterval: Interval | null;
    exactValueAtRisk: number | null;
    exactTailValueAtRisk: number | null;
    exactWithinInterval: boolean | null;
  }[];
  probabilities: { claimsExceedBudget: SimulatedProbability; claimsExceedPremium: SimulatedProbability; capitalInsufficient: SimulatedProbability };
  expectedShortfall: number;
  analytic: {
    mean: number;
    sd: number;
    distribution: { available: true; method: 'EXACT' | 'PANJER' } | { available: false; reason: string };
    meanWithinInterval: boolean;
  };
  /** counts[i] simulated periods fell in [from + i·binWidth, from + (i + 1)·binWidth); `above` lie beyond the last bin. */
  histogram: { from: number; binWidth: number; counts: number[]; above: number };
  exceedanceCurve: { threshold: number; simulated: number; exact: number | null }[];
  convergence: { simulations: number; mean: number; lower: number; upper: number; probabilityClaimsExceedBudget: number }[];
}

export interface SimulationInputs {
  assumptions: PricingAssumptions;
  initialCapital: number;
  premiumCharged: number | null;
}

export interface SimulationRunSummary {
  id: string;
  label: string | null;
  engineVersion: string;
  currency: string;
  stale: boolean;
  seed: number;
  simulations: number;
  durationMs: number;
  portfolio: { frequency: FrequencyFamily; severity: SeverityFamily; policies: number };
  headline: {
    mean: number;
    valueAtRisk995: number | null;
    tailValueAtRisk995: number | null;
    probabilityClaimsExceedBudget: number;
    probabilityCapitalInsufficient: number;
    premiumCharged: number;
    initialCapital: number;
  };
  createdAt: string;
}

export interface SimulationRunDetail extends SimulationRunSummary {
  inputs: SimulationInputs;
  results: SimulationResult;
}

export interface RunSimulationRequest {
  assumptions: PricingAssumptions;
  simulations: number;
  seed?: number;
  initialCapital: number;
  premiumCharged?: number;
  label?: string;
}

/* ---------- Claims reserving ---------- */

/** A triangle cell: null is a missing amount, never zero. */
export type Cell = number | null;
export type FactorAverage = 'VOLUME_WEIGHTED' | 'SIMPLE_AVERAGE' | 'LATEST_DIAGONALS';
export type ReservingBasis = 'PAID' | 'INCURRED';
export type ReservingMethod =
  | 'CHAIN_LADDER_PAID'
  | 'CHAIN_LADDER_INCURRED'
  | 'EXPECTED_LOSS_RATIO'
  | 'BORNHUETTER_FERGUSON_PAID'
  | 'BORNHUETTER_FERGUSON_INCURRED';

/** Row k (0-based) of a triangle lists cumulative amounts for development years 1 to n − k. */
export interface ReservingData {
  firstOrigin: number;
  paid: Cell[][];
  incurred: Cell[][] | null;
  premiums: number[] | null;
}

export interface ReservingAssumptions {
  average: FactorAverage;
  latestDiagonals: number | null;
  tail: { paid: number; incurred: number };
  selectedFactors: { paid: Cell[] | null; incurred: Cell[] | null };
  expectedLossRatio: number | null;
}

export interface ReservingRequest {
  data: ReservingData;
  assumptions: ReservingAssumptions;
}

export interface ReservingLimits {
  minOrigins: number;
  maxOrigins: number;
  minFirstOrigin: number;
  maxFirstOrigin: number;
  maxAmount: number;
  minFactor: number;
  maxFactor: number;
  minTail: number;
  maxTail: number;
  minLossRatio: number;
  maxLossRatio: number;
}

export interface ReservingExample {
  id: string;
  name: string;
  description: string;
  provenance: 'FICTIONAL';
  data: ReservingData;
  assumptions: ReservingAssumptions;
}

export interface ReservingCatalogue {
  modelVersion: string;
  currency: string;
  limits: ReservingLimits;
  averages: FactorAverage[];
  methods: { id: ReservingMethod; label: string }[];
  examples: ReservingExample[];
}

export interface FactorRow {
  from: number;
  to: number;
  pairs: number;
  volumeWeighted: number | null;
  simpleAverage: number | null;
  latestDiagonals: number | null;
  min: number | null;
  max: number | null;
  estimated: number | null;
  selected: number;
  source: 'ESTIMATED' | 'SELECTED';
}

export interface ChainLadderResult {
  basis: ReservingBasis;
  factors: FactorRow[];
  tail: number;
  cdf: number[];
  percentDeveloped: number[];
  linkRatios: Cell[][];
  incremental: Cell[][];
  projected: Cell[][];
  origins: { origin: number; age: number; latest: number; cdf: number; ultimate: number; development: number }[];
  totals: { latest: number; ultimate: number; development: number };
}

export type MethodEstimate =
  | {
      method: ReservingMethod;
      available: true;
      origins: { origin: number; ultimate: number; unpaid: number; ibnr: number | null }[];
      totals: { ultimate: number; unpaid: number; ibnr: number | null };
    }
  | { method: ReservingMethod; available: false; reason: string };

export interface PaidVsIncurredLine {
  paidUltimate: number;
  incurredUltimate: number;
  difference: number;
  relativeDifference: number | null;
}

export interface ReservingResult {
  modelVersion: string;
  firstOrigin: number;
  origins: number[];
  valuationYear: number;
  averaging: { method: FactorAverage; latestDiagonals: number | null };
  chainLadder: { paid: ChainLadderResult; incurred: ChainLadderResult | null };
  paidVsIncurred: { origins: (PaidVsIncurredLine & { origin: number })[]; totals: PaidVsIncurredLine } | null;
  reserves: {
    origins: { origin: number; premium: number | null; paid: number; incurred: number | null; caseReserve: number | null }[];
    totals: { premium: number | null; paid: number; incurred: number | null; caseReserve: number | null };
  };
  methods: MethodEstimate[];
  reconciliation: { holds: boolean; maxDifference: number };
  sensitivity: {
    scenarios: {
      id: string;
      label: string;
      unpaid: Partial<Record<ReservingMethod, number | null>>;
      change: Partial<Record<ReservingMethod, number | null>>;
      note: string | null;
    }[];
    factors: { basis: ReservingBasis; from: number; to: number; change: number }[];
  };
  /** Undiscounted expected payments of the paid chain ladder by future calendar year, for asset–liability work. */
  cashFlows: {
    basis: 'CHAIN_LADDER_PAID';
    currency: string;
    valuationYear: number;
    discounting: 'NONE';
    periods: { calendarYear: number; expectedPayment: number }[];
    afterLastDevelopmentYear: number;
    total: number;
  };
  warnings: { code: string; message: string }[];
}

export interface ReservingProvenance {
  kind: 'MODEL_ESTIMATE';
  currency: string;
  modelVersion: string;
  note: string;
}

export interface ReservingAnalysis {
  provenance: ReservingProvenance;
  results: ReservingResult;
}

export interface ReservingRunSummary {
  id: string;
  label: string;
  modelVersion: string;
  stale: boolean;
  currency: string;
  firstOrigin: number;
  originCount: number;
  valuationYear: number;
  dataChecksum: string;
  headline: {
    paid: number;
    incurred: number | null;
    caseReserve: number | null;
    methods: { method: ReservingMethod; ultimate: number | null; unpaid: number | null }[];
    warnings: number;
  };
  createdAt: string;
}

export interface ReservingRunDetail extends ReservingRunSummary {
  inputs: ReservingRequest;
  results: ReservingResult;
}

export interface ActuarialOverview {
  modelVersion: string;
  currency: string;
  reference: { id: string; name: string; description: string; provenance: 'FICTIONAL'; pricing: PricingResult };
  scenarios: { available: true; count: number; limit: number; recent: ScenarioSummary[] } | { available: false; reason: string };
  simulations: { available: true; count: number; kept: number; recent: SimulationRunSummary[] } | { available: false; reason: string };
  reserving:
    | { available: true; count: number; kept: number; recent: { id: string; label: string; valuationYear: number; createdAt: string }[] }
    | { available: false; reason: string };
  workspaces: { id: string; title: string; status: 'AVAILABLE' | 'PLANNED' }[];
}

@Injectable({ providedIn: 'root' })
export class ActuarialApi {
  private readonly api = inject(ApiClient);

  overview(): Promise<ActuarialOverview> {
    return this.api.request('/actuarial/overview', { method: 'GET' });
  }

  presets(): Promise<{ modelVersion: string; currency: string; presets: ActuarialPreset[] }> {
    return this.api.request('/actuarial/presets', { method: 'GET' });
  }

  price(assumptions: PricingAssumptions, init: { signal?: AbortSignal } = {}): Promise<PricingResult> {
    return this.api.request('/actuarial/pricing/calculate', { method: 'POST', body: assumptions, signal: init.signal });
  }

  scenarios(): Promise<{ limit: number; scenarios: ScenarioSummary[] }> {
    return this.api.request('/actuarial/scenarios', { method: 'GET' });
  }

  saveScenario(name: string, assumptions: PricingAssumptions): Promise<ScenarioDetail> {
    return this.api.request('/actuarial/scenarios', { method: 'POST', body: { name, assumptions } });
  }

  scenario(id: string): Promise<ScenarioDetail> {
    return this.api.request(`/actuarial/scenarios/${id}`, { method: 'GET' });
  }

  deleteScenario(id: string): Promise<void> {
    return this.api.request(`/actuarial/scenarios/${id}`, { method: 'DELETE' });
  }

  simulate(body: RunSimulationRequest): Promise<SimulationRunDetail> {
    return this.api.request('/actuarial/simulations', { method: 'POST', body });
  }

  simulations(): Promise<{ kept: number; runs: SimulationRunSummary[] }> {
    return this.api.request('/actuarial/simulations', { method: 'GET' });
  }

  simulation(id: string): Promise<SimulationRunDetail> {
    return this.api.request(`/actuarial/simulations/${id}`, { method: 'GET' });
  }

  deleteSimulation(id: string): Promise<void> {
    return this.api.request(`/actuarial/simulations/${id}`, { method: 'DELETE' });
  }

  reservingExamples(): Promise<ReservingCatalogue> {
    return this.api.request('/actuarial/reserving/examples', { method: 'GET' });
  }

  analyzeReserving(body: ReservingRequest, init: { signal?: AbortSignal } = {}): Promise<ReservingAnalysis> {
    return this.api.request('/actuarial/reserving/analyze', { method: 'POST', body, signal: init.signal });
  }

  saveReservingRun(label: string, request: ReservingRequest): Promise<ReservingRunDetail> {
    return this.api.request('/actuarial/reserving/runs', { method: 'POST', body: { label, ...request } });
  }

  reservingRuns(): Promise<{ kept: number; runs: ReservingRunSummary[] }> {
    return this.api.request('/actuarial/reserving/runs', { method: 'GET' });
  }

  reservingRun(id: string): Promise<ReservingRunDetail> {
    return this.api.request(`/actuarial/reserving/runs/${id}`, { method: 'GET' });
  }

  deleteReservingRun(id: string): Promise<void> {
    return this.api.request(`/actuarial/reserving/runs/${id}`, { method: 'DELETE' });
  }
}
