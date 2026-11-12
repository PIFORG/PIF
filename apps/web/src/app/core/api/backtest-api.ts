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
  { id: 'BUY_AND_HOLD', label: 'Acheter et conserver', hint: 'Poids égaux à partir de la première exécution.' },
  { id: 'MA_CROSSOVER', label: 'Croisement de moyennes mobiles', hint: 'Position longue quand la MM courte dépasse la MM longue sur le premier symbole.' },
  {
    id: 'PERIODIC_REBALANCE',
    label: 'Rééquilibrage périodique',
    hint: 'Poids égaux, recalculés toutes les N barres (21 par défaut).',
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
