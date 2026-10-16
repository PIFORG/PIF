import type { NavIcon } from '@/lib/navigation/workspaceNav';

export type BlueprintKind = 'chart' | 'table' | 'form' | 'kpis' | 'list' | 'heatmap';

export interface BlueprintBlock {
  title: string;
  kind: BlueprintKind;
  /** Grid columns out of 3. */
  span: 1 | 2 | 3;
  note: string;
}

export interface ApiContract {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  purpose: string;
}

export interface ModuleDefinition {
  slug: string;
  title: string;
  group: string;
  icon: NavIcon;
  summary: string;
  capabilities: string[];
  blueprint: BlueprintBlock[];
  contracts: ApiContract[];
  concepts: { term: string; definition: string }[];
  safeguard?: string;
}

export const MODULES: Record<string, ModuleDefinition> = {
  markets: {
    slug: 'markets',
    title: 'Markets',
    group: 'Workspace',
    icon: 'markets',
    summary: 'Browse simulated instruments, follow price action and build watchlists before you trade.',
    capabilities: [
      'Instrument search across equities, bonds, FX and commodities',
      'Price chart with selectable ranges and session statistics',
      'Personal watchlists with change and trend columns',
      'Market status and data timestamps on every quote',
    ],
    blueprint: [
      { title: 'Instrument search', kind: 'form', span: 1, note: 'Symbol, name or asset class' },
      { title: 'Price chart', kind: 'chart', span: 2, note: 'OHLC / line with range selector' },
      { title: 'Watchlist', kind: 'table', span: 2, note: 'Last, change, trend, as-of time' },
      { title: 'Session statistics', kind: 'kpis', span: 1, note: 'Open, high, low, volume' },
    ],
    contracts: [
      { method: 'GET', path: '/markets/instruments', purpose: 'Searchable instrument catalogue' },
      { method: 'GET', path: '/markets/instruments/:symbol/quotes', purpose: 'Latest simulated quote with timestamp' },
      { method: 'GET', path: '/markets/instruments/:symbol/candles', purpose: 'Historical candles by range' },
      { method: 'GET', path: '/watchlists', purpose: 'User watchlists (CRUD)' },
    ],
    concepts: [
      { term: 'Bid / ask spread', definition: 'The gap between the best price a buyer will pay and a seller will accept; a direct trading cost.' },
      { term: 'OHLC', definition: 'Open, high, low and close prices for a period — the building block of a candlestick chart.' },
      { term: 'Liquidity', definition: 'How easily an asset can be traded without moving its price.' },
    ],
  },
  trading: {
    slug: 'trading',
    title: 'Trading Desk',
    group: 'Workspace',
    icon: 'trading',
    summary: 'Place simulated market and limit orders against virtual capital and review every execution.',
    capabilities: [
      'Order ticket with market, limit and stop orders',
      'Pre-trade check of buying power, estimated cost and fees',
      'Open orders blotter with cancel and amend',
      'Execution history with fill price and slippage',
    ],
    blueprint: [
      { title: 'Order ticket', kind: 'form', span: 1, note: 'Side, type, quantity, limit price' },
      { title: 'Price & depth', kind: 'chart', span: 2, note: 'Intraday chart and simulated order book' },
      { title: 'Open orders', kind: 'table', span: 2, note: 'Status, filled quantity, cancel' },
      { title: 'Buying power', kind: 'kpis', span: 1, note: 'Cash, reserved, available' },
    ],
    contracts: [
      { method: 'POST', path: '/orders', purpose: 'Submit a simulated order (idempotency key required)' },
      { method: 'GET', path: '/orders', purpose: 'Open and historical orders' },
      { method: 'DELETE', path: '/orders/:id', purpose: 'Cancel an open order' },
      { method: 'GET', path: '/accounts/me/buying-power', purpose: 'Cash, reserved and available capital' },
    ],
    concepts: [
      { term: 'Market order', definition: 'Executes immediately at the best available price; price is not guaranteed.' },
      { term: 'Limit order', definition: 'Executes only at the limit price or better; execution is not guaranteed.' },
      { term: 'Slippage', definition: 'The difference between the expected price and the actual fill price.' },
    ],
    safeguard: 'Order submission stays disabled until the simulated execution engine is connected. No order is ever sent to a real market.',
  },
  portfolios: {
    slug: 'portfolios',
    title: 'Portfolios',
    group: 'Workspace',
    icon: 'portfolio',
    summary: 'Create virtual portfolios, track positions and measure performance against a benchmark.',
    capabilities: [
      'Multiple virtual portfolios with starting capital',
      'Positions with cost basis, market value and unrealised P&L',
      'Performance versus benchmark with time-weighted returns',
      'Allocation by asset class, sector and currency',
    ],
    blueprint: [
      { title: 'Portfolio summary', kind: 'kpis', span: 3, note: 'Value, return, cash, unrealised P&L' },
      { title: 'Performance', kind: 'chart', span: 2, note: 'Equity curve vs benchmark' },
      { title: 'Allocation', kind: 'heatmap', span: 1, note: 'Weights by asset class' },
      { title: 'Positions', kind: 'table', span: 3, note: 'Qty, average price, last, P&L' },
    ],
    contracts: [
      { method: 'GET', path: '/portfolios', purpose: 'User portfolios' },
      { method: 'POST', path: '/portfolios', purpose: 'Create a virtual portfolio' },
      { method: 'GET', path: '/portfolios/:id/positions', purpose: 'Positions with valuation' },
      { method: 'GET', path: '/portfolios/:id/performance', purpose: 'Return series and benchmark' },
    ],
    concepts: [
      { term: 'Unrealised P&L', definition: 'Gain or loss on positions you still hold, measured at the current price.' },
      { term: 'Time-weighted return', definition: 'Performance that removes the effect of deposits and withdrawals.' },
      { term: 'Diversification', definition: 'Spreading exposure so a single asset has limited impact on the whole.' },
    ],
  },
  risk: {
    slug: 'risk',
    title: 'Risk Analytics',
    group: 'Workspace',
    icon: 'risk',
    summary: 'Measure how much a simulated portfolio could lose and where that risk comes from.',
    capabilities: [
      'Value at risk and expected shortfall at 95% and 99%',
      'Volatility, beta and maximum drawdown',
      'Risk contribution by position and asset class',
      'Correlation matrix of holdings',
    ],
    blueprint: [
      { title: 'Risk summary', kind: 'kpis', span: 3, note: 'VaR, ES, volatility, beta, drawdown' },
      { title: 'Return distribution', kind: 'chart', span: 2, note: 'Histogram with VaR threshold' },
      { title: 'Risk contribution', kind: 'list', span: 1, note: 'Top contributors' },
      { title: 'Correlation matrix', kind: 'heatmap', span: 3, note: 'Pairwise correlations' },
    ],
    contracts: [
      { method: 'GET', path: '/portfolios/:id/risk', purpose: 'Risk metrics with method and confidence level' },
      { method: 'GET', path: '/portfolios/:id/risk/contributions', purpose: 'Risk decomposition' },
      { method: 'GET', path: '/portfolios/:id/risk/correlations', purpose: 'Correlation matrix' },
    ],
    concepts: [
      { term: 'Value at risk (VaR)', definition: 'A loss level that should not be exceeded with a given confidence over a given horizon.' },
      { term: 'Expected shortfall', definition: 'The average loss in the cases where VaR is exceeded.' },
      { term: 'Maximum drawdown', definition: 'The largest peak-to-trough fall in portfolio value.' },
    ],
  },
  strategies: {
    slug: 'strategies',
    title: 'Strategies & Backtesting',
    group: 'Research & AI',
    icon: 'strategy',
    summary: 'Define rule-based strategies and replay them on historical scenarios to see how they would have behaved.',
    capabilities: [
      'Strategy builder with entry, exit and position-sizing rules',
      'Backtests over selectable periods with transaction costs',
      'Equity curve, drawdown and trade list',
      'Side-by-side comparison with a benchmark',
    ],
    blueprint: [
      { title: 'Strategy rules', kind: 'form', span: 1, note: 'Signals, sizing, costs' },
      { title: 'Backtest equity curve', kind: 'chart', span: 2, note: 'Strategy vs benchmark' },
      { title: 'Statistics', kind: 'kpis', span: 1, note: 'CAGR, Sharpe, drawdown, win rate' },
      { title: 'Trade list', kind: 'table', span: 2, note: 'Entry, exit, return per trade' },
    ],
    contracts: [
      { method: 'GET', path: '/strategies', purpose: 'Saved strategies' },
      { method: 'POST', path: '/backtests', purpose: 'Queue a backtest job' },
      { method: 'GET', path: '/backtests/:id', purpose: 'Job status and results' },
    ],
    concepts: [
      { term: 'Backtest', definition: 'Applying a strategy to historical data to estimate how it would have performed.' },
      { term: 'Overfitting', definition: 'Tuning a strategy so closely to past data that it fails on new data.' },
      { term: 'Sharpe ratio', definition: 'Excess return per unit of volatility.' },
    ],
    safeguard: 'Past simulated performance does not predict future results.',
  },
  backtesting: {
    slug: 'backtesting',
    title: 'Backtesting',
    group: 'Research & AI',
    icon: 'strategy',
    summary: 'Run a saved strategy over a historical window and inspect every simulated trade.',
    capabilities: [
      'Choose a strategy, period, starting capital and cost model',
      'Asynchronous jobs with progress and cancellation',
      'Results with equity curve, drawdown and trade list',
      'Exportable report',
    ],
    blueprint: [
      { title: 'Run configuration', kind: 'form', span: 1, note: 'Strategy, period, capital, costs' },
      { title: 'Equity & drawdown', kind: 'chart', span: 2, note: 'Two stacked series' },
      { title: 'Job history', kind: 'table', span: 3, note: 'Status, duration, headline statistics' },
    ],
    contracts: [
      { method: 'POST', path: '/backtests', purpose: 'Queue a backtest job' },
      { method: 'GET', path: '/backtests', purpose: 'Job history' },
      { method: 'GET', path: '/backtests/:id', purpose: 'Status and results' },
      { method: 'DELETE', path: '/backtests/:id', purpose: 'Cancel a running job' },
    ],
    concepts: [
      { term: 'Look-ahead bias', definition: 'Accidentally using information that would not have been available at the time.' },
      { term: 'Transaction costs', definition: 'Fees and spreads that reduce real returns, often ignored in naive backtests.' },
      { term: 'Out-of-sample test', definition: 'Validating a strategy on data that was not used to design it.' },
    ],
    safeguard: 'Past simulated performance does not predict future results.',
  },
  ai: {
    slug: 'ai',
    title: 'AI Insights',
    group: 'Research & AI',
    icon: 'ai',
    summary: 'Model-generated observations about simulated portfolios and markets, always with confidence and limitations.',
    capabilities: [
      'Portfolio observations such as concentration or drift',
      'Scenario summaries in plain language',
      'Confidence level, data window and model version on every insight',
      'Link to the explanation for each insight',
    ],
    blueprint: [
      { title: 'Insight feed', kind: 'list', span: 2, note: 'Observation, confidence, as-of time' },
      { title: 'Model card', kind: 'kpis', span: 1, note: 'Version, training window, known limits' },
      { title: 'Insight detail', kind: 'chart', span: 3, note: 'Supporting data and explanation link' },
    ],
    contracts: [
      { method: 'GET', path: '/ai/insights', purpose: 'Insights with confidence and provenance' },
      { method: 'GET', path: '/ai/models/:id', purpose: 'Model card' },
    ],
    concepts: [
      { term: 'Confidence', definition: 'How strongly a model supports an output — not the probability that it is correct in the real world.' },
      { term: 'Model drift', definition: 'Degradation when live data differs from the data the model learned from.' },
      { term: 'Human in the loop', definition: 'A person reviews and decides; the model only informs.' },
    ],
    safeguard: 'AI insights are educational and are never investment advice. No AI score is shown until a real model is connected.',
  },
  explainability: {
    slug: 'explainability',
    title: 'Explainable AI',
    group: 'Research & AI',
    icon: 'xai',
    summary: 'See which inputs drove a model output and how sensitive it is to change.',
    capabilities: [
      'Feature attribution for an individual output',
      'Global feature importance for a model',
      'What-if sensitivity on key inputs',
      'Plain-language summary of the explanation',
    ],
    blueprint: [
      { title: 'Attribution waterfall', kind: 'chart', span: 2, note: 'Contribution of each input' },
      { title: 'Explanation summary', kind: 'list', span: 1, note: 'Top drivers in words' },
      { title: 'Global importance', kind: 'heatmap', span: 3, note: 'Feature importance by model' },
    ],
    contracts: [
      { method: 'GET', path: '/ai/insights/:id/explanation', purpose: 'Local attribution for one output' },
      { method: 'GET', path: '/ai/models/:id/importance', purpose: 'Global feature importance' },
    ],
    concepts: [
      { term: 'Feature attribution', definition: 'How much each input pushed a specific prediction up or down.' },
      { term: 'SHAP values', definition: 'A game-theory based method that fairly splits a prediction among inputs.' },
      { term: 'Sensitivity analysis', definition: 'Changing one input to see how much the output moves.' },
    ],
  },
  'stress-testing': {
    slug: 'stress-testing',
    title: 'Bank Stress Testing',
    group: 'Research & AI',
    icon: 'bank',
    summary: 'Apply macroeconomic shocks to a sample bank balance sheet and follow the effect on capital.',
    capabilities: [
      'Scenario library: rate shock, credit deterioration, liquidity run',
      'Custom shock sizes with transparent assumptions',
      'Capital ratio path versus regulatory minimums',
      'Step-by-step breakdown of losses',
    ],
    blueprint: [
      { title: 'Scenario', kind: 'form', span: 1, note: 'Rates, defaults, deposit outflow' },
      { title: 'Capital ratio path', kind: 'chart', span: 2, note: 'CET1 against minimum' },
      { title: 'Loss breakdown', kind: 'table', span: 3, note: 'By portfolio and risk type' },
    ],
    contracts: [
      { method: 'GET', path: '/stress/scenarios', purpose: 'Scenario library' },
      { method: 'POST', path: '/stress/runs', purpose: 'Run a scenario on the sample balance sheet' },
      { method: 'GET', path: '/stress/runs/:id', purpose: 'Results and loss breakdown' },
    ],
    concepts: [
      { term: 'CET1 ratio', definition: 'Core equity capital divided by risk-weighted assets — the main measure of bank solvency.' },
      { term: 'Risk-weighted assets', definition: 'Assets scaled by their riskiness for capital requirements.' },
      { term: 'Liquidity coverage', definition: 'Whether liquid assets can cover 30 days of stressed outflows.' },
    ],
  },
  actuarial: {
    slug: 'actuarial',
    title: 'Actuarial Lab',
    group: 'Insurance',
    icon: 'actuarial',
    summary: 'Price insurance products and estimate reserves from transparent, editable assumptions.',
    capabilities: [
      'Mortality and lapse tables',
      'Premium pricing for term and whole-life products',
      'Reserve projections with discount-rate sensitivity',
      'Assumption log for reproducibility',
    ],
    blueprint: [
      { title: 'Assumptions', kind: 'form', span: 1, note: 'Table, interest, expenses' },
      { title: 'Reserve projection', kind: 'chart', span: 2, note: 'Reserves by policy year' },
      { title: 'Life table', kind: 'table', span: 3, note: 'Age, qx, lx, dx' },
    ],
    contracts: [
      { method: 'GET', path: '/actuarial/tables', purpose: 'Mortality and lapse tables' },
      { method: 'POST', path: '/actuarial/pricing', purpose: 'Premium calculation' },
      { method: 'POST', path: '/actuarial/reserves', purpose: 'Reserve projection' },
    ],
    concepts: [
      { term: 'Mortality rate (qx)', definition: 'The probability that a person aged x dies within one year.' },
      { term: 'Net premium', definition: 'The premium that exactly funds expected benefits, before expenses and margin.' },
      { term: 'Reserve', definition: 'Money set aside today to meet future policy obligations.' },
    ],
  },
  learn: {
    slug: 'learn',
    title: 'Academy',
    group: 'Learn',
    icon: 'academy',
    summary: 'Structured lessons that connect market theory to the tools in your workspace.',
    capabilities: [
      'Learning paths by experience level',
      'Short lessons with checks for understanding',
      'Progress tracking and resume',
      'Links from lessons straight into the relevant module',
    ],
    blueprint: [
      { title: 'Your path', kind: 'list', span: 2, note: 'Modules and lessons in order' },
      { title: 'Progress', kind: 'kpis', span: 1, note: 'Completed, in progress, streak' },
      { title: 'Lesson player', kind: 'chart', span: 3, note: 'Content, quiz, next step' },
    ],
    contracts: [
      { method: 'GET', path: '/learning/paths', purpose: 'Paths for the user experience level' },
      { method: 'GET', path: '/learning/lessons/:id', purpose: 'Lesson content' },
      { method: 'POST', path: '/learning/progress', purpose: 'Record progress' },
    ],
    concepts: [
      { term: 'Risk and return', definition: 'Higher expected returns usually require accepting higher uncertainty.' },
      { term: 'Compounding', definition: 'Earning returns on previous returns, which accelerates growth over time.' },
      { term: 'Asset classes', definition: 'Groups of investments with similar behaviour: equities, bonds, cash, commodities.' },
    ],
  },
  challenges: {
    slug: 'challenges',
    title: 'Challenges',
    group: 'Learn',
    icon: 'challenge',
    summary: 'Time-boxed simulated trading challenges with clear rules and a fair leaderboard.',
    capabilities: [
      'Challenge rules: capital, instruments, duration, risk limits',
      'Live standings ranked on risk-adjusted return',
      'Post-challenge review of your decisions',
    ],
    blueprint: [
      { title: 'Active challenges', kind: 'list', span: 2, note: 'Rules, start, end, participants' },
      { title: 'Your standing', kind: 'kpis', span: 1, note: 'Rank, return, risk score' },
      { title: 'Leaderboard', kind: 'table', span: 3, note: 'Ranked by risk-adjusted return' },
    ],
    contracts: [
      { method: 'GET', path: '/challenges', purpose: 'Open and past challenges' },
      { method: 'POST', path: '/challenges/:id/join', purpose: 'Join a challenge' },
      { method: 'GET', path: '/challenges/:id/leaderboard', purpose: 'Standings' },
    ],
    concepts: [
      { term: 'Risk-adjusted return', definition: 'Return judged against the risk taken to earn it, so luck from large bets counts less.' },
      { term: 'Position limits', definition: 'Caps on exposure that keep competition focused on decisions, not leverage.' },
    ],
  },
};
