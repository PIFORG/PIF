import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

/** Types and endpoints of apps/web/src/lib/api/trading.ts. Every price, fill and metric is computed by the server. */

export type AssetClass = 'EQUITY' | 'FUND' | 'BOND' | 'COMMODITY' | 'FX';
export type TradeSide = 'BUY' | 'SELL';
export type TradeOrderType = 'MARKET' | 'LIMIT' | 'STOP';
export type TradeOrderStatus = 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
export type HistoryRange = '1D' | '5D' | '1M' | '3M' | '6M' | 'ALL';

export interface Provenance {
  providerId: string;
  kind: 'FICTIONAL' | 'HISTORICAL' | 'DELAYED' | 'LIVE';
  currency: string;
  description: string;
}

export interface Quote {
  mid: number;
  bid: number;
  ask: number;
  spreadBps: number;
  depth: number;
  asOf: string;
  validUntil: string;
}

export interface InstrumentView {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  sector: string;
  currency: string;
  status: 'ACTIVE' | 'HALTED';
  priceDecimals: number;
  quantityDecimals: number;
  lotSize: number;
  fees: { feeBps: number; minFee: number };
  fictional: boolean;
  provenance: Provenance;
  quote: Quote | null;
  previousClose: number | null;
  /** Percent, as in the learning API: 2.11 means +2.11 %. */
  changePct: number | null;
}

export interface MarketStatus {
  provenance: Provenance;
  serverTime: string;
  dataStart: string;
  quotePeriodSeconds: number;
  currentPeriod: { start: string; end: string } | null;
  tradingHours: string;
  dataKinds?: string[];
  quality?: {
    missingObservationPolicy: string;
    corporateActions: string;
    adjustments: string;
  };
  assetClassConventions?: { assetClass: string; status: string; note: string }[];
}

export interface MarketSnapshot {
  provenance: Provenance;
  asOf: string;
  instruments: InstrumentView[];
}

export interface PriceHistory {
  symbol: string;
  range: HistoryRange;
  resolution: string;
  currency: string;
  provenance: Provenance;
  points: { at: string; mid: number }[];
}

export interface WatchlistResponse {
  items: { addedAt: string; instrument: InstrumentView }[];
}

export interface PositionView {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  sector: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  price: number;
  bid: number;
  ask: number;
  marketValue: number;
  unrealizedPnl: number;
  /** Ratio: 0.05 means +5 %. */
  unrealizedPct: number | null;
  /** Ratio of equity. */
  weight: number | null;
  quoteAsOf: string;
}

export interface PortfolioSummary {
  id: string;
  name: string;
  baseCurrency: string;
  status: 'ACTIVE' | 'CLOSED';
  version: number;
  createdAt: string;
  asOf: string;
  valuationConvention: string;
  initialCapital: number;
  netContributions: number;
  cash: number;
  reservedCash: number;
  availableCash: number;
  positionsValue: number;
  equity: number;
  profit: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feesPaid: number;
  spreadCost: number;
  maxPositionWeightPct: number;
  openOrders: number;
  positions: PositionView[];
}

export interface Rejection {
  code: string;
  message: string;
}

export interface OrderEvaluation {
  accepted: boolean;
  rejection: Rejection | null;
  referencePrice: number;
  estimate: { notional: number; fee: number; total: number };
  executesNow: boolean;
  fillableNow: number;
  availableCash: number;
  held: number;
  equity: number;
  warnings: string[];
}

export interface OrderPreviewResult extends OrderEvaluation {
  portfolioVersion: number;
  quote: Quote & { symbol: string };
  provenance: Provenance;
}

export interface OrderView {
  id: string;
  clientOrderId: string;
  symbol: string | null;
  side: TradeSide;
  type: TradeOrderType;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  triggered: boolean;
  status: TradeOrderStatus;
  averagePrice: number | null;
  rejectionCode: string | null;
  statusReason: string | null;
  quoteAtSubmission: { mid: number; bid: number; ask: number; asOf: string };
  providerId: string;
  submittedAt: string;
  expiresAt: string | null;
  closedAt: string | null;
}

export interface ExecutionView {
  id: string;
  orderId: string;
  symbol: string | null;
  side: TradeSide;
  quantity: number;
  price: number;
  notional: number;
  fee: number;
  spreadCost: number;
  realizedPnl: number | null;
  cashImpact: number;
  quote: { mid: number; bid: number; ask: number };
  providerId: string;
  executedAt: string;
  recordedAt: string;
}

export interface SubmitOrderResult {
  replayed: boolean;
  order: OrderView;
  executions: ExecutionView[];
  evaluation: OrderEvaluation | null;
  portfolio: PortfolioSummary;
}

export interface OrderTerms {
  symbol: string;
  side: TradeSide;
  type: TradeOrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
}

export interface Metric {
  value: number | null;
  unavailableReason: string | null;
  requirement: string;
}

export interface AllocationLine {
  name: string;
  label?: string;
  value: number;
  weight: number | null;
}

export interface PortfolioAnalytics {
  portfolioId: string;
  asOf: string;
  currency: string;
  provenance: Provenance;
  valuation: {
    convention: string;
    equity: number;
    cash: number;
    reservedCash: number;
    availableCash: number;
    positionsValue: number;
    liquidationValue: number;
    costBasis: number;
    unrealizedPnl: number;
    realizedPnl: number;
    feesPaid: number;
    spreadCost: number;
  };
  reconciliation: {
    description: string;
    equity: number;
    netContributions: number;
    profit: number;
    realizedPnl: number;
    unrealizedPnl: number;
    difference: number;
    cashLedgerSum: number;
    cashMatchesLedger: boolean;
  };
  allocation: {
    cash: { value: number; weight: number | null };
    byInstrument: AllocationLine[];
    bySector: AllocationLine[];
    byAssetClass: AllocationLine[];
  };
  concentration: { largestWeight: Metric; exposure: Metric; hhi: Metric; effectiveHoldings: Metric };
  performance: { profit: Metric; timeWeightedReturn: Metric; moneyWeightedReturn: Metric; completeDays: number };
  risk: {
    valueAtRisk95: Metric;
    expectedShortfall95: Metric;
    holdingsVolatilityDaily: Metric;
    observations: number;
    realizedVolatilityDaily: Metric;
    realizedVolatilityAnnualized: Metric;
    maxDrawdown: Metric;
  };
  stress: {
    id: string;
    name: string;
    description: string;
    hypothetical: boolean;
    impact: number;
    impactPct: number | null;
    equityAfter: number;
    breakdown: { symbol: string; value: number; shockPct: number; impact: number }[];
  }[];
  methodology?: {
    horizon: string;
    confidenceLevel: number;
    dataPeriod: string;
    observationFrequency: string;
    currency: string;
    calculationMethod: string;
    assumptions: string[];
    limitations: string[];
    metricSource: Record<string, string>;
    minVarObservations: number;
  };
  riskContributions?: {
    available: boolean;
    basis?: string;
    unavailableReason?: string;
    tailDays?: number;
    byInstrument: {
      symbol: string;
      value: number;
      weight: number | null;
      tailLossContribution: number;
      shareOfTailLoss: number | null;
    }[];
  };
  diversification?: {
    meanPairwiseCorrelation: number | null;
    unavailableReason: string | null;
    pairs: number;
    requirement?: string;
  };
}

export interface RiskSnapshot {
  cash: number;
  positionsValue: number;
  equity: number;
  exposure: number;
  largestWeight: number;
  hhi: number | null;
  effectiveHoldings: number | null;
  maxPositionWeightPct: number | null;
  withinPositionLimit: boolean;
}

export interface PreTradeRiskResult {
  portfolioId: string;
  asOf: string;
  currency: string;
  provenance: Provenance;
  hypothetical: boolean;
  note: string;
  quote: Quote & { symbol: string };
  evaluation: OrderEvaluation;
  current: RiskSnapshot;
  proposed: RiskSnapshot | null;
  delta: {
    cash: number;
    positionsValue: number;
    equity: number;
    exposure: number;
    largestWeight: number;
  } | null;
}

export interface CashEntryView {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'BUY' | 'SELL';
  amount: number;
  balanceAfter: number;
  executionId: string | null;
  description: string;
  occurredAt: string;
}

export interface EquityHistory {
  convention: string;
  points: { at: string; equity: number; netContributions: number; current: boolean }[];
}

export const ORDER_STATUS_LABEL: Record<TradeOrderStatus, string> = {
  OPEN: 'En cours',
  PARTIALLY_FILLED: 'Partiellement exécuté · en cours',
  FILLED: 'Exécuté',
  CANCELLED: 'Annulé',
  REJECTED: 'Rejeté',
  EXPIRED: 'Expiré',
};

@Injectable({ providedIn: 'root' })
export class MarketApi {
  private readonly api = inject(ApiClient);

  status(): Promise<MarketStatus> {
    return this.api.request<MarketStatus>('/market/status', { method: 'GET' });
  }

  instruments(query: { q?: string; assetClass?: AssetClass } = {}): Promise<MarketSnapshot> {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.assetClass) params.set('assetClass', query.assetClass);
    const suffix = params.size ? `?${params.toString()}` : '';
    return this.api.request<MarketSnapshot>(`/market/instruments${suffix}`, { method: 'GET' });
  }

  instrument(symbol: string): Promise<InstrumentView> {
    return this.api.request<InstrumentView>(`/market/instruments/${encodeURIComponent(symbol)}`, { method: 'GET' });
  }

  history(symbol: string, range: HistoryRange): Promise<PriceHistory> {
    return this.api.request<PriceHistory>(`/market/instruments/${encodeURIComponent(symbol)}/history?range=${range}`, {
      method: 'GET',
    });
  }

  watchlist(): Promise<WatchlistResponse> {
    return this.api.request<WatchlistResponse>('/market/watchlist', { method: 'GET' });
  }

  watch(symbol: string): Promise<WatchlistResponse> {
    return this.api.request<WatchlistResponse>(`/market/watchlist/${encodeURIComponent(symbol)}`, { method: 'PUT' });
  }

  unwatch(symbol: string): Promise<WatchlistResponse> {
    return this.api.request<WatchlistResponse>(`/market/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
  }
}

@Injectable({ providedIn: 'root' })
export class PortfolioApi {
  private readonly api = inject(ApiClient);

  list(): Promise<{ portfolios: PortfolioSummary[] }> {
    return this.api.request('/portfolios', { method: 'GET' });
  }

  create(input: { name: string; initialCapital: number; maxPositionWeightPct?: number }): Promise<PortfolioSummary> {
    return this.api.request('/portfolios', { method: 'POST', body: input });
  }

  get(id: string): Promise<PortfolioSummary> {
    return this.api.request(`/portfolios/${id}`, { method: 'GET' });
  }

  preview(id: string, terms: OrderTerms): Promise<OrderPreviewResult> {
    return this.api.request(`/portfolios/${id}/orders/preview`, { method: 'POST', body: terms });
  }

  submit(
    id: string,
    input: OrderTerms & { clientOrderId: string; expectedVersion: number; quoteAsOf: string },
  ): Promise<SubmitOrderResult> {
    return this.api.request(`/portfolios/${id}/orders`, { method: 'POST', body: input });
  }

  cancel(id: string, orderId: string): Promise<{ order: OrderView; portfolio: PortfolioSummary }> {
    return this.api.request(`/portfolios/${id}/orders/${orderId}/cancel`, { method: 'POST' });
  }

  orders(id: string, status: 'open' | 'closed' | 'all' = 'all', limit = 100): Promise<{ portfolioVersion: number; orders: OrderView[] }> {
    return this.api.request(`/portfolios/${id}/orders?status=${status}&limit=${limit}`, { method: 'GET' });
  }

  executions(id: string, limit = 100): Promise<{ executions: ExecutionView[] }> {
    return this.api.request(`/portfolios/${id}/executions?limit=${limit}`, { method: 'GET' });
  }

  cashEntries(id: string, limit = 100): Promise<{ entries: CashEntryView[] }> {
    return this.api.request(`/portfolios/${id}/cash-entries?limit=${limit}`, { method: 'GET' });
  }

  cashFlow(id: string, input: { type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; expectedVersion: number }): Promise<PortfolioSummary> {
    return this.api.request(`/portfolios/${id}/cash-flows`, { method: 'POST', body: input });
  }

  analytics(id: string): Promise<PortfolioAnalytics> {
    return this.api.request(`/portfolios/${id}/analytics`, { method: 'GET' });
  }

  preTradeRisk(id: string, terms: OrderTerms): Promise<PreTradeRiskResult> {
    return this.api.request(`/portfolios/${id}/risk/pretrade`, { method: 'POST', body: terms });
  }

  history(id: string): Promise<EquityHistory> {
    return this.api.request(`/portfolios/${id}/history`, { method: 'GET' });
  }
}

const ACTIVE_PORTFOLIO_KEY = 'pif.activePortfolioId';

/** Remembers which portfolio the desk shows. Only an id, never balances or credentials. */
export function rememberPortfolio(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_PORTFOLIO_KEY, id);
    else window.localStorage.removeItem(ACTIVE_PORTFOLIO_KEY);
  } catch {
    /* storage unavailable: the desk falls back to the first portfolio */
  }
}

export function rememberedPortfolio(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_PORTFOLIO_KEY);
  } catch {
    return null;
  }
}
