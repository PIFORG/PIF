import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';
import type { HistoryRange, Provenance } from './trading-api';

export type BacktestStrategyId = 'BUY_AND_HOLD' | 'MA_CROSSOVER' | 'PERIODIC_REBALANCE';

export interface BacktestRunRequest {
  strategy: BacktestStrategyId;
  symbols: string[];
  start: string;
  end: string;
  params?: {
    shortPeriod?: number;
    longPeriod?: number;
    rebalanceEvery?: number;
    riskFreeAnnual?: number;
  };
  initialCash: number;
  feeBps?: number;
  slippageBps?: number;
}

export interface BacktestMetricsView {
  totalReturn: number;
  annualizedReturn: number | null;
  volatilityAnnualized: number | null;
  maxDrawdown: number;
  sharpe: number | null;
  totalFees: number;
  totalSlippageCost: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  winRate: number | null;
  benchmarkTotalReturn: number | null;
  excessReturnVsBenchmark: number | null;
  calendarDays: number;
  annualization: string;
}

export interface BacktestTrade {
  at: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  fee: number;
  slippageCost: number;
  cashAfter: number;
}

export interface BacktestResult {
  provenance: Provenance;
  executionConvention: string;
  assumptions: string[];
  strategy: BacktestStrategyId;
  symbols: string[];
  start: string;
  end: string;
  initialCash: number;
  feeBps: number;
  slippageBps: number;
  params: Record<string, number>;
  barCount: number;
  metrics: BacktestMetricsView;
  equityCurve: { at: string; equity: number; cash: number; positionsValue: number; drawdown: number }[];
  drawdown: { at: string; drawdown: number }[];
  trades: BacktestTrade[];
  finalCash: number;
  finalPositions: Record<string, number>;
}

export interface IndicatorSeriesResponse {
  symbol: string;
  range: HistoryRange;
  resolution: string;
  currency: string;
  provenance: Provenance;
  points: { at: string; mid: number }[];
  indicators: Record<string, unknown>;
  defaults: Record<string, string>;
}

export const BACKTEST_STRATEGIES: { id: BacktestStrategyId; label: string; hint: string }[] = [
  { id: 'BUY_AND_HOLD', label: 'Buy and hold', hint: 'Equal weight from the first fill onward.' },
  { id: 'MA_CROSSOVER', label: 'Moving-average crossover', hint: 'Long when SMA(short) > SMA(long) on the first symbol.' },
  {
    id: 'PERIODIC_REBALANCE',
    label: 'Periodic rebalancing',
    hint: 'Equal weight, restated every N bars (default 21).',
  },
];

@Injectable({ providedIn: 'root' })
export class BacktestApi {
  private readonly api = inject(ApiClient);

  run(body: BacktestRunRequest): Promise<BacktestResult> {
    return this.api.request<BacktestResult>('/backtests/run', { method: 'POST', body });
  }

  indicators(symbol: string, range: HistoryRange = '3M', kinds = 'SMA,EMA,RSI,MACD,BB'): Promise<IndicatorSeriesResponse> {
    const q = new URLSearchParams({ range, kinds });
    return this.api.request<IndicatorSeriesResponse>(
      `/market/instruments/${encodeURIComponent(symbol)}/indicators?${q}`,
      { method: 'GET' },
    );
  }
}
