import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

/** Bank stress testing (Spring `/api/stress`). Amounts are in millions of dinars (M DT); ratios are fractions. */

export type BankId = 'CONVENTIONAL' | 'PARTICIPATIVE';
export type FactorKey =
  | 'rateShockBps'
  | 'equityShockPct'
  | 'unemploymentShockPp'
  | 'gdpShockPp'
  | 'propertyShockPct'
  | 'revenueShockPct'
  | 'defaultMultiplier'
  | 'runoffMultiplier';
export type StressFactorValues = Record<FactorKey, number>;
export type ResilienceStatus = 'RESILIENT' | 'UNDER_WATCH' | 'VULNERABLE';

export interface FactorDefinition {
  key: FactorKey;
  label: string;
  unit: string;
  neutral: number;
  min: number;
  max: number;
  description: string;
}

export interface StressPreset {
  id: string;
  name: string;
  description: string;
  factors: StressFactorValues;
}

export interface Thresholds {
  cet1Minimum: number;
  cet1Buffer: number;
  leverageMinimum: number;
  lcrMinimum: number;
}

export interface Ratios {
  cet1: number;
  rwa: number;
  cet1Ratio: number;
  totalExposure: number;
  leverageRatio: number;
  hqla: number;
  netOutflows: number;
  lcr: number;
}

export interface Projection extends Ratios {
  netIncome: number;
  preTaxIncome: number;
  creditCost: number;
  marginIncome: number;
  feesAndOther: number;
  bondRevaluation: number;
  equityRevaluation: number;
}

export interface SheetLine {
  key: string;
  label: string;
  amount: number;
  group: string;
}

export interface BankDescription {
  id: BankId;
  name: string;
  kind: BankId;
  kindLabel: string;
  description: string;
  specificities: string[];
  balanceSheet: { assets: SheetLine[]; liabilities: SheetLine[]; cet1: number; totalAssets: number; totalLiabilitiesAndEquity: number };
  initial: Ratios;
  participative?: {
    alpha: number;
    dcrPassThrough: number;
    lossAbsorption: number;
    profitEqualisationReserve: number;
    investmentRiskReserve: number;
  };
}

export interface StressCatalog {
  modelVersion: string;
  horizon: string;
  unit: string;
  thresholds: Thresholds;
  factors: FactorDefinition[];
  presets: StressPreset[];
  maxIntensity: number;
  banks: BankDescription[];
  assumptions: string[];
  limitations: string[];
}

export interface Contribution {
  factor: FactorKey;
  label: string;
  value: number;
}

export interface CreditSegmentResult {
  key: string;
  label: string;
  ead: number;
  pdBase: number;
  pdStressed: number;
  lgdBase: number;
  lgdStressed: number;
  eclBase: number;
  eclStressed: number;
  residualValueLoss: number;
  newlyDefaulted: number;
}

export interface PlsResult {
  key: string;
  label: string;
  exposure: number;
  lossRateBase: number;
  lossRateStressed: number;
  lossBase: number;
  lossStressed: number;
}

export interface BankRun {
  id: BankId;
  name: string;
  kind: BankId;
  kindLabel: string;
  projections: { initial: Ratios; baseline: Projection; stressed: Projection };
  resilience: {
    status: ResilienceStatus;
    statusLabel: string;
    checks: { key: string; label: string; value: number; threshold: number; ok: boolean }[];
    cet1DepletionPp: number;
    capitalShortfall: number;
    liquidityShortfall: number;
  };
  capitalBridge: { start: number; steps: { key: string; label: string; amount: number }[]; end: number };
  lossAbsorption: LossAbsorption;
  credit: CreditSegmentResult[];
  profitAndLossSharing: PlsResult[];
  participativeMechanisms?: {
    psia: number;
    psiaShareOfAssets: number;
    alpha: number;
    perUsed: number;
    dcrCost: number;
    psiaPoolLoss: number;
    irrUsed: number;
    psiaAbsorbed: number;
  };
  attribution: {
    method: string;
    methodLabel: string;
    reference: string;
    cet1Ratio: Contribution[];
    lcr: Contribution[];
    cet1RatioTotal: number;
    lcrTotal: number;
    explanation: string[];
  };
  aiEstimate?: AiEstimate;
}

export type AbsorptionKind = 'CREDIT' | 'SECURITIES' | 'MARGIN' | 'FEES' | 'DCR' | 'RESERVE' | 'PSIA' | 'TAX' | 'CAPITAL';

export interface AbsorptionItem {
  key: string;
  label: string;
  kind: AbsorptionKind;
  /** M DT, always positive; the column says whether it is a source or an absorber. */
  amount: number;
}

/** Where the shock comes from and who bears it, against the one-year baseline; both columns sum to `total`. */
export interface LossAbsorption {
  reference: string;
  total: number;
  capitalConsumed: number;
  sources: AbsorptionItem[];
  absorbers: AbsorptionItem[];
}

export interface StressPreview {
  ready: boolean;
  modelVersion: string;
  factors: StressFactorValues;
  banks: {
    id: BankId;
    cet1ChangePp: number;
    lcrChangePp: number;
    cet1Ratio: number;
    lcr: number;
    baselineCet1Ratio: number;
    baselineLcr: number;
  }[];
  outsideTrainingRange?: FactorKey[];
}

export type EmulatorTarget = 'CET1_CHANGE_PP' | 'LCR_CHANGE_PP';

export interface TargetEstimate {
  label: string;
  /** Changes in percentage points against the one-year baseline. */
  gbm: number;
  linear: number;
  engine: number;
  gbmError: number;
  linearError: number;
  modelReference: number;
  contributions: { factor: FactorKey; label: string; model: number; engine: number }[];
  /** Σ|φ model − φ engine| / Σ|φ engine|; null when the engine change is zero. */
  explanationGap: number | null;
  /** null when the engine shows no change, so there is nothing to compare. */
  sameTopFactor: boolean | null;
}

export type AiEstimate = { outsideTrainingRange: FactorKey[] } & Record<EmulatorTarget, TargetEstimate>;

export type ModelId = 'MEAN' | 'LINEAR' | 'GBM';
export interface Scores {
  mae: number;
  rmse: number;
  r2: number;
}
export interface BreachScores {
  rows: number;
  actualBreaches: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number | null;
  recall: number | null;
  accuracy: number;
}

export interface ModelCard {
  modelVersion: string;
  engineVersion: string;
  purpose: string;
  nature: string;
  protocol: {
    features: string[];
    rowsPerScenario: number;
    trainingRows: number;
    validationRows: number;
    testRows: number;
    extrapolationRows: number;
    seeds: Record<string, number>;
    neutralProbability: number;
    samplingRanges: { factor: FactorKey; label: string; trainingMin: number; trainingMax: number; acceptedMin: number; acceptedMax: number }[];
    description: string[];
  };
  models: { id: ModelId; label: string; description: string }[];
  targets: Record<
    EmulatorTarget,
    {
      target: EmulatorTarget;
      label: string;
      metrics: Record<'validation' | 'test' | 'extrapolation', Record<ModelId, Scores>>;
      permutationImportance: { feature: string; label: string; gbm: number; gbmStd: number; linear: number }[];
      linearCoefficients: { feature: string; label: string; perStandardDeviation: number; perUnit: number }[];
      boostingRounds: number;
      validationCurve: [number, number][];
    }
  >;
  breachDetection: { definition: string; test: Record<'LINEAR' | 'GBM', BreachScores>; extrapolation: Record<'LINEAR' | 'GBM', BreachScores> };
  limitations: string[];
}

export interface MetricPair {
  conventional: number;
  participative: number;
  difference: number;
}

export interface StressRunResult {
  modelVersion: string;
  method: string;
  scenario: {
    presetId: string | null;
    name: string;
    description: string;
    intensity: number;
    factors: StressFactorValues;
    activeFactors: FactorKey[];
  };
  banks: BankRun[];
  comparison: {
    metrics: Record<'cet1Ratio' | 'cet1DepletionPp' | 'leverageRatio' | 'lcr' | 'netIncome' | 'creditCost', MetricPair>;
    factorGaps: { factor: FactorKey; label: string; conventional: number; participative: number; gap: number }[];
    explanation: string[];
  };
  sensitivity: ({ intensity: number } & Record<BankId, { cet1Ratio: number; lcr: number }>)[];
  thresholds: Thresholds;
  assumptions: string[];
  limitations: string[];
}

export interface StressRunRequest {
  scenario?: string;
  factors?: Partial<StressFactorValues>;
  intensity?: number;
}

@Injectable({ providedIn: 'root' })
export class StressApi {
  private readonly api = inject(ApiClient);

  catalog(): Promise<StressCatalog> {
    return this.api.request<StressCatalog>('/stress/catalog', { method: 'GET' });
  }

  run(body: StressRunRequest): Promise<StressRunResult> {
    return this.api.request<StressRunResult>('/stress/run', { method: 'POST', body });
  }

  preview(body: StressRunRequest): Promise<StressPreview> {
    return this.api.request<StressPreview>('/stress/preview', { method: 'POST', body });
  }

  model(): Promise<ModelCard> {
    return this.api.request<ModelCard>('/stress/model', { method: 'GET' });
  }
}
