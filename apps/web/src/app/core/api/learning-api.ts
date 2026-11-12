import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

/**
 * Types and endpoints of apps/web/src/lib/api/learning.ts (contract: apps/api/src/learning/learning.controller.ts and
 * learning.view.ts). Prices, fills, scores and mentor feedback are all computed by the server.
 */

export type LearningLevel = 'ROOKIE' | 'STRATEGIST' | 'COMMANDER';
export type Competency = 'MARKET_UNDERSTANDING' | 'TRADING_EXECUTION' | 'RISK_MANAGEMENT' | 'DIVERSIFICATION' | 'STRATEGIC_REASONING';
export type MissionAvailability = 'IMPLEMENTED' | 'CONFIGURED' | 'PLANNED';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';
export type Rationale = 'LIMIT_DOWNSIDE' | 'DIVERSIFY' | 'REACT_TO_NEWS' | 'TAKE_PROFIT' | 'REBALANCE' | 'LONG_TERM_VIEW' | 'FOLLOW_MOMENTUM';
export type SessionMentorMode = 'GUIDED' | 'SOCRATIC' | 'CRITICAL';
export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ABANDONED';
export type ObjectiveStatus = 'PENDING' | 'ON_TRACK' | 'AT_RISK' | 'MET' | 'NOT_MET' | 'FAILED';

export const LEVEL_LABEL: Record<LearningLevel, string> = {
  ROOKIE: 'Trader débutant',
  STRATEGIST: 'Stratège marché',
  COMMANDER: 'Commandant risque',
};

export const COMPETENCY_LABEL: Record<Competency, string> = {
  MARKET_UNDERSTANDING: 'Compréhension des marchés',
  TRADING_EXECUTION: 'Exécution des ordres',
  RISK_MANAGEMENT: 'Gestion du risque',
  DIVERSIFICATION: 'Diversification du portefeuille',
  STRATEGIC_REASONING: 'Raisonnement stratégique',
};

export const RATIONALE_LABEL: Record<Rationale, string> = {
  LIMIT_DOWNSIDE: 'Limiter la baisse',
  DIVERSIFY: 'Diversifier',
  REACT_TO_NEWS: "Réagir à l'actualité",
  TAKE_PROFIT: 'Prendre des bénéfices',
  REBALANCE: 'Rééquilibrer',
  LONG_TERM_VIEW: 'Vision long terme',
  FOLLOW_MOMENTUM: 'Suivre la tendance',
};

export const AVAILABILITY_LABEL: Record<MissionAvailability, string> = {
  IMPLEMENTED: 'Disponible',
  CONFIGURED: 'Jouable · en revue',
  PLANNED: 'Prévue',
};

export interface MissionSummary {
  slug: string;
  version: number;
  order: number;
  title: string;
  level: LearningLevel;
  availability: MissionAvailability;
  summary: string;
  estimatedMinutes: number;
  competencies: { competency: Competency; weight: number }[];
  playable: boolean;
  levelLocked: boolean;
  relatedStorySlug: string | null;
  progress: { attempts: number; passed: boolean; bestScore: number | null; activeSessionId: string | null };
}

export interface MissionBriefing {
  slug: string;
  version: number;
  title: string;
  level: LearningLevel;
  availability: MissionAvailability;
  summary: string;
  estimatedMinutes: number;
  competencies: { competency: Competency; weight: number }[];
  learningOutcomes: string[];
  briefing: { context: string; rules: string[]; tips: string[] };
  currency: string;
  initialCash: number;
  initialPositions: { symbol: string; quantity: number }[];
  steps: number;
  stepLabel: 'day' | 'week';
  assets: { symbol: string; name: string; sector: string }[];
  rules: {
    allowedOrderTypes: OrderType[];
    feeBps: number;
    minFee: number;
    maxPositionWeightPct?: number;
    allowStressTest: boolean;
    requireConfidence?: boolean;
  };
  objectives: { id: string; kind: string; label: string; required: boolean }[];
  failure: { kind: 'MAX_LOSS'; limitPct: number }[];
  scoring: { weights: { risk: number; decision: number; reasoning: number; execution: number }; passThreshold: number };
  mentorMode: SessionMentorMode;
  relatedStorySlug: string | null;
  provenance: string;
}

export interface ObjectiveResult {
  id: string;
  kind: string;
  label: string;
  required: boolean;
  status: ObjectiveStatus;
  detail: string;
}

export interface Metrics {
  equity: number;
  cash: number;
  invested: number;
  totalReturnPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  maxDrawdownPct: number;
  volatilityPct: number | null;
  var95: number | null;
  es95: number | null;
  varObservations: number;
  hhi: number | null;
  effectiveAssets: number | null;
  maxWeightPct: number;
  exposurePct: number;
  feesPaid: number;
  spreadCost: number;
  turnover: number;
  fills: number;
  ordersPlaced: number;
  ordersRejected: number;
}

export interface MissionOrderView {
  id: string;
  seq: number;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  filledQuantity: number;
  averageFillPrice: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  triggered: boolean;
  status: 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
  statusReason: string | null;
  createdStep: number;
  rationale: Rationale;
  confidence: number | null;
  fees: number;
}

export interface MissionQuote {
  symbol: string;
  name: string;
  sector: string;
  bid: number;
  ask: number;
  mid: number;
  depth: number;
  spreadBps: number;
  changePct: number;
}

export interface MissionPosition {
  symbol: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  weightPct: number;
}

export interface MissionNews {
  id: string;
  step: number;
  kind: string;
  sentiment: 'NEGATIVE' | 'POSITIVE' | 'MIXED';
  headline: string;
  body: string;
}

export interface StressTestResult {
  scenarioId: string;
  name: string;
  step: number;
  impact: number;
  impactPct: number;
  breakdown: { symbol: string; value: number; shockPct: number; impact: number }[];
}

export interface SessionState {
  step: number;
  steps: number;
  stepLabel: 'day' | 'week';
  marketClosed: boolean;
  status: 'ACTIVE' | 'COMPLETED' | 'FAILED';
  failureReason: string | null;
  quotes: MissionQuote[];
  priceHistory: Record<string, { step: number; mid: number }[]>;
  portfolio: {
    cash: number;
    reservedCash: number;
    availableCash: number;
    equity: number;
    initialEquity: number;
    realizedPnl: number;
    feesPaid: number;
    positions: MissionPosition[];
  };
  orders: MissionOrderView[];
  news: MissionNews[];
  objectives: ObjectiveResult[];
  metrics: Metrics;
  equityCurve: { step: number; equity: number; exposurePct: number }[];
  stressScenarios: { id: string; name: string; description: string }[];
  stressTests: StressTestResult[];
  hintsUsed: number;
}

export interface LearningSession {
  id: string;
  kind: 'MISSION' | 'REPLAY';
  status: SessionStatus;
  missionSlug: string;
  missionVersion: number;
  parentSessionId: string | null;
  branchFromSeq: number | null;
  mentorMode: SessionMentorMode;
  assisted: boolean;
  lastSeq: number;
  startedAt: string;
  endedAt: string | null;
  countsTowardProfile: boolean;
  mission: MissionBriefing;
  state: SessionState;
}

export interface PlaceOrderCommand {
  type: 'PLACE_ORDER';
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  rationale: Rationale;
  confidence?: number;
}

export type Command =
  | PlaceOrderCommand
  | { type: 'CANCEL_ORDER'; orderId: string }
  | { type: 'ADVANCE' }
  | { type: 'FINISH' }
  | { type: 'RUN_STRESS_TEST'; scenarioId: string };

/**
 * Retrospective confidence review, never scored. Assessments stored before assessment-1.1 compared
 * raw final prices and have no method, observations, interpretability or signals.
 */
export interface Calibration {
  method?: 'MARKET_ADJUSTED';
  orders: number;
  observations?: number;
  minimumOrders?: number;
  interpretable?: boolean;
  meanConfidence: number | null;
  hitRate: number | null;
  brierScore: number | null;
  signals?: { id: string; orders: number; detail: string }[];
}

/** Server pre-trade check: the same rules as placing the order, nothing recorded. Amounts in DT. */
export interface OrderPreview {
  seq: number;
  accepted: boolean;
  code: string | null;
  message: string | null;
  estimate: { price: number; notional: number; fee: number; total: number } | null;
  warnings: string[];
}

export interface CommandResponse {
  replayed: boolean;
  outcome: 'ACCEPTED' | 'REJECTED';
  message: string;
  session: LearningSession;
}

export interface MentorMessage {
  mode: SessionMentorMode | 'DEBRIEF';
  source: 'RULE_BASED';
  sourceLabel: string;
  topic: string;
  message: string;
  questions: string[];
  evidence: string[];
  ruleId: string;
}

export interface Evidence {
  label: string;
  score: number | null;
  detail: string;
}

export type AssessmentComponentKey = 'risk' | 'decision' | 'reasoning' | 'execution';

export interface Assessment {
  engineVersion: string;
  missionSlug: string;
  total: number;
  passed: boolean;
  passThreshold: number;
  failedByRule: boolean;
  failureReason: string | null;
  requiredObjectivesMet: boolean;
  objectives: ObjectiveResult[];
  components: { key: AssessmentComponentKey; score: number | null; configuredWeight: number; appliedWeight: number; evidence: Evidence[] }[];
  competencyScores: Record<Competency, number | null>;
  assisted: boolean;
  hintsUsed: number;
  metrics: Metrics;
  strengths: string[];
  improvements: string[];
  calibration: Calibration;
  countsTowardProfile: boolean;
}

export interface CompetencyMastery {
  competency: Competency;
  score: number | null;
  unassistedScore: number | null;
  assistedScore: number | null;
  evidence: number;
  evidenceLevel: 'NONE' | 'EMERGING' | 'DEVELOPING' | 'ESTABLISHED';
  observations: number;
  trend: number | null;
}

export interface LearningProfile {
  experienceLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  unlockedLevel: LearningLevel;
  competencies: CompetencyMastery[];
  stats: { missionsPassed: number; missionsAttempted: number; assessedSessions: number; implementedMissions: number; playableMissions: number };
  activeSessions: { id: string; kind: 'MISSION' | 'REPLAY'; missionSlug: string; missionTitle: string; currentStep: number; updatedAt: string }[];
  recentAssessments: {
    sessionId: string;
    missionSlug: string;
    missionTitle: string;
    total: number;
    passed: boolean;
    assisted: boolean;
    createdAt: string;
  }[];
  recommendations: { slug: string; title: string; level: LearningLevel; reason: string }[];
  calibration: {
    ratedOrders: number;
    observations: number;
    minimumOrders: number;
    interpretable: boolean;
    brierScore: number | null;
    meanConfidence: number | null;
    hitRate: number | null;
    signals: number;
    note: string;
  };
}

export interface TimelineDecision {
  seq: number;
  step: number;
  type: string;
  summary: string;
  rationale: Rationale | null;
  outcome: 'ACCEPTED' | 'REJECTED';
  at: string;
}

export interface TimelineBranch {
  id: string;
  status: SessionStatus;
  branchFromSeq: number | null;
  startedAt: string;
  assessment: { total: number; passed: boolean } | null;
}

export interface Timeline {
  sessionId: string;
  kind: 'MISSION' | 'REPLAY';
  status: SessionStatus;
  missionSlug: string;
  missionTitle: string;
  canBranch: boolean;
  decisions: TimelineDecision[];
  equityCurve: { step: number; equity: number }[];
  news: { id: string; step: number; headline: string; sentiment: string }[];
  branches: TimelineBranch[];
}

export interface ComparedSession {
  id: string;
  kind: 'MISSION' | 'REPLAY';
  status: SessionStatus;
  branchFromSeq: number | null;
  countsTowardProfile: boolean;
  step: number;
  decisions: number;
  metrics: Metrics;
  assessment: { total: number; passed: boolean; components: { key: string; score: number | null }[] } | null;
  equityCurve: { step: number; equity: number }[];
}

export interface Comparison {
  missionSlug: string;
  missionTitle: string;
  divergenceSeq: number | null;
  note: string;
  sessions: ComparedSession[];
}

export type BranchStrategy = 'MANUAL' | 'HOLD';

@Injectable({ providedIn: 'root' })
export class LearningApi {
  private readonly api = inject(ApiClient);

  missions(): Promise<{ unlockedLevel: LearningLevel; missions: MissionSummary[] }> {
    return this.api.request('/learning/missions', { method: 'GET' });
  }

  mission(slug: string): Promise<MissionBriefing> {
    return this.api.request(`/learning/missions/${encodeURIComponent(slug)}`, { method: 'GET' });
  }

  start(slug: string, mentorMode?: SessionMentorMode): Promise<{ resumed: boolean; session: LearningSession }> {
    return this.api.request(`/learning/missions/${encodeURIComponent(slug)}/sessions`, {
      method: 'POST',
      body: mentorMode ? { mentorMode } : {},
    });
  }

  profile(): Promise<LearningProfile> {
    return this.api.request('/learning/profile', { method: 'GET' });
  }

  session(id: string): Promise<LearningSession> {
    return this.api.request(`/learning/sessions/${id}`, { method: 'GET' });
  }

  command(id: string, input: { idempotencyKey: string; expectedSeq: number; command: Command }): Promise<CommandResponse> {
    return this.api.request(`/learning/sessions/${id}/commands`, { method: 'POST', body: input });
  }

  previewOrder(id: string, order: PlaceOrderCommand): Promise<OrderPreview> {
    return this.api.request(`/learning/sessions/${id}/orders/preview`, { method: 'POST', body: { order } });
  }

  abandon(id: string): Promise<LearningSession> {
    return this.api.request(`/learning/sessions/${id}/abandon`, { method: 'POST' });
  }

  assessment(id: string): Promise<Assessment> {
    return this.api.request(`/learning/sessions/${id}/assessment`, { method: 'GET' });
  }

  mentor(id: string, mode?: SessionMentorMode | 'DEBRIEF'): Promise<{ mentor: MentorMessage; session: LearningSession }> {
    return this.api.request(`/learning/sessions/${id}/mentor`, { method: 'POST', body: mode ? { mode } : {} });
  }

  timeline(id: string): Promise<Timeline> {
    return this.api.request(`/learning/sessions/${id}/timeline`, { method: 'GET' });
  }

  branch(id: string, fromSeq: number, strategy: BranchStrategy): Promise<LearningSession> {
    return this.api.request(`/learning/sessions/${id}/branches`, { method: 'POST', body: { fromSeq, strategy } });
  }

  compare(id: string, otherId: string): Promise<Comparison> {
    return this.api.request(`/learning/sessions/${id}/compare/${otherId}`, { method: 'GET' });
  }
}

/* ---------------------------------------------------------------- FinStories */

export type StoryCharacter = 'SARAH' | 'ADAM' | 'YOUSSEF';

export interface StoryProgress {
  positionMs: number;
  completed: boolean;
  reflection: string | null;
  /** The story was edited since progress was saved; playback restarts at the same scene when it still exists. */
  updatedSinceLastWatch: boolean;
  /** An earlier version was watched to the end, the current one not yet. */
  watchedEarlierVersion: boolean;
}

export interface StorySummary {
  slug: string;
  version: number;
  title: string;
  character: StoryCharacter;
  summary: string;
  competency: Competency;
  level: LearningLevel;
  relatedMissionSlug: string | null;
  durationMs: number;
  media: { videoUrl: string | null; posterUrl: string | null; format: 'MOTION_GRAPHICS' };
  progress: StoryProgress;
  recommended?: boolean;
}

/** The FinStories feed shown on the MarketQuest hub (GET /learning/stories). */
@Injectable({ providedIn: 'root' })
export class StoriesFeedApi {
  private readonly api = inject(ApiClient);

  feed(): Promise<{ weakestCompetency: Competency | null; stories: StorySummary[] }> {
    return this.api.request('/learning/stories', { method: 'GET' });
  }
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function formatDT(value: number, digits = 2): string {
  const text = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  return `${value < 0 ? '\u2212' : ''}${text} DT`;
}
