import type { Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import {
  LearningApi,
  type Assessment,
  type Comparison,
  type LearningSession,
  type MissionBriefing,
  type MissionSummary,
  type SessionState,
  type Timeline,
} from '../core/api/learning-api';
import { ApiError } from '../core/api/types';
import { MissionBriefingPage } from './mission-briefing.page';
import { MissionPlayerPage } from './mission-player.page';
import { SessionReviewPage } from './session-review.page';

/* ---------------------------------------------------------------- fixtures (shapes of apps/api/src/learning/learning.view.ts) */

function briefing(overrides: Partial<MissionBriefing> = {}): MissionBriefing {
  return {
    slug: 'protect-your-capital',
    version: 1,
    title: 'Protect Your Capital',
    level: 'ROOKIE',
    availability: 'IMPLEMENTED',
    summary: 'Keep losses small while the market wobbles.',
    estimatedMinutes: 12,
    competencies: [
      { competency: 'RISK_MANAGEMENT', weight: 0.6 },
      { competency: 'TRADING_EXECUTION', weight: 0.4 },
    ],
    learningOutcomes: ['Use a stop order to cap a loss.'],
    briefing: { context: 'You hold a bank stock before a volatile week.', rules: ['Prices move once per day.'], tips: ['Read the news first.'] },
    currency: 'TND',
    initialCash: 9000,
    initialPositions: [{ symbol: 'AAA', quantity: 100 }],
    steps: 10,
    stepLabel: 'day',
    assets: [
      { symbol: 'AAA', name: 'Alpha Bank', sector: 'Banking' },
      { symbol: 'BBB', name: 'Beta Telecom', sector: 'Telecom' },
    ],
    rules: { allowedOrderTypes: ['MARKET', 'LIMIT', 'STOP'], feeBps: 25, minFee: 0.5, maxPositionWeightPct: 40, allowStressTest: true },
    objectives: [
      { id: 'drawdown', kind: 'MAX_DRAWDOWN', label: 'Keep drawdown under 8 %', required: true },
      { id: 'stop', kind: 'USE_STOP', label: 'Protect a position', required: false },
    ],
    failure: [{ kind: 'MAX_LOSS', limitPct: 15 }],
    scoring: { weights: { risk: 40, decision: 25, reasoning: 20, execution: 15 }, passThreshold: 60 },
    mentorMode: 'GUIDED',
    relatedStorySlug: 'sarah-and-the-market-crash',
    provenance: 'Fictional deterministic scenario.',
    ...overrides,
  };
}

function summary(overrides: Partial<MissionSummary> = {}): MissionSummary {
  return {
    slug: 'protect-your-capital',
    version: 1,
    order: 2,
    title: 'Protect Your Capital',
    level: 'ROOKIE',
    availability: 'IMPLEMENTED',
    summary: 'Keep losses small while the market wobbles.',
    estimatedMinutes: 12,
    competencies: [],
    playable: true,
    levelLocked: false,
    relatedStorySlug: null,
    progress: { attempts: 0, passed: false, bestScore: null, activeSessionId: null },
    ...overrides,
  };
}

const metrics = {
  equity: 10000,
  cash: 9000,
  invested: 1000,
  totalReturnPct: 0,
  realizedPnl: 0,
  unrealizedPnl: -1,
  maxDrawdownPct: 1.2,
  volatilityPct: 0.85,
  var95: 41.6,
  es95: 55,
  varObservations: 20,
  hhi: 0.5,
  effectiveAssets: 2,
  maxWeightPct: 10,
  exposurePct: 10,
  feesPaid: 2.5,
  spreadCost: 1,
  turnover: 1000,
  fills: 1,
  ordersPlaced: 2,
  ordersRejected: 0,
};

function state(overrides: Partial<SessionState> = {}): SessionState {
  return {
    step: 2,
    steps: 10,
    stepLabel: 'day',
    marketClosed: false,
    status: 'ACTIVE',
    failureReason: null,
    quotes: [
      { symbol: 'AAA', name: 'Alpha Bank', sector: 'Banking', bid: 9.99, ask: 10.01, mid: 10, depth: 1200, spreadBps: 20, changePct: 1.5 },
      { symbol: 'BBB', name: 'Beta Telecom', sector: 'Telecom', bid: 19.98, ask: 20.02, mid: 20, depth: 800, spreadBps: 20, changePct: -0.5 },
    ],
    priceHistory: {
      AAA: [
        { step: -2, mid: 9.5 },
        { step: -1, mid: 9.8 },
        { step: 0, mid: 9.9 },
        { step: 1, mid: 9.85 },
        { step: 2, mid: 10 },
      ],
      BBB: [
        { step: -2, mid: 20.5 },
        { step: 2, mid: 20 },
      ],
    },
    portfolio: {
      cash: 9000,
      reservedCash: 195,
      availableCash: 8805,
      equity: 10000,
      initialEquity: 10000,
      realizedPnl: 0,
      feesPaid: 2.5,
      positions: [{ symbol: 'AAA', quantity: 100, averageCost: 10.01, costBasis: 1001, marketValue: 1000, unrealizedPnl: -1, weightPct: 10 }],
    },
    orders: [
      {
        id: 'o-2',
        seq: 2,
        symbol: 'BBB',
        side: 'BUY',
        type: 'LIMIT',
        quantity: 10,
        filledQuantity: 0,
        averageFillPrice: null,
        limitPrice: 19.5,
        stopPrice: null,
        triggered: false,
        status: 'OPEN',
        statusReason: null,
        createdStep: 2,
        rationale: 'DIVERSIFY',
        confidence: null,
        fees: 0,
      },
      {
        id: 'o-1',
        seq: 1,
        symbol: 'AAA',
        side: 'BUY',
        type: 'MARKET',
        quantity: 100,
        filledQuantity: 100,
        averageFillPrice: 10.01,
        limitPrice: null,
        stopPrice: null,
        triggered: false,
        status: 'FILLED',
        statusReason: null,
        createdStep: 1,
        rationale: 'LONG_TERM_VIEW',
        confidence: null,
        fees: 2.5,
      },
    ],
    news: [{ id: 'n-1', step: 2, kind: 'EARNINGS', sentiment: 'POSITIVE', headline: 'Alpha beats forecasts', body: 'Profit rose 12 %.' }],
    objectives: [{ id: 'drawdown', kind: 'MAX_DRAWDOWN', label: 'Keep drawdown under 8 %', required: true, status: 'ON_TRACK', detail: 'Drawdown 1.2 %' }],
    metrics,
    equityCurve: [
      { step: 0, equity: 10000, exposurePct: 0 },
      { step: 1, equity: 9998, exposurePct: 10 },
      { step: 2, equity: 10000, exposurePct: 10 },
    ],
    stressScenarios: [{ id: 'crash', name: 'Market crash', description: 'Equities fall 20 %.' }],
    stressTests: [],
    hintsUsed: 0,
    ...overrides,
  };
}

function session(overrides: Partial<LearningSession> = {}, stateOverrides: Partial<SessionState> = {}): LearningSession {
  return {
    id: 's-1',
    kind: 'MISSION',
    status: 'ACTIVE',
    missionSlug: 'protect-your-capital',
    missionVersion: 1,
    parentSessionId: null,
    branchFromSeq: null,
    mentorMode: 'GUIDED',
    assisted: false,
    lastSeq: 2,
    startedAt: '2026-11-10T09:00:00.000Z',
    endedAt: null,
    countsTowardProfile: true,
    mission: briefing(),
    state: state(stateOverrides),
    ...overrides,
  };
}

function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    engineVersion: 'assessment-1.1',
    missionSlug: 'protect-your-capital',
    total: 72,
    passed: true,
    passThreshold: 60,
    failedByRule: false,
    failureReason: null,
    requiredObjectivesMet: true,
    objectives: [{ id: 'drawdown', kind: 'MAX_DRAWDOWN', label: 'Keep drawdown under 8 %', required: true, status: 'MET', detail: 'Drawdown 3.1 %' }],
    components: [
      { key: 'risk', score: 80, configuredWeight: 40, appliedWeight: 50, evidence: [{ label: 'Drawdown', score: 82.4, detail: 'Max drawdown 3.1 %.' }] },
      { key: 'reasoning', score: null, configuredWeight: 20, appliedWeight: 0, evidence: [{ label: 'Rationales', score: null, detail: 'Not enough orders.' }] },
    ],
    competencyScores: {
      MARKET_UNDERSTANDING: null,
      TRADING_EXECUTION: 64.6,
      RISK_MANAGEMENT: 80,
      DIVERSIFICATION: null,
      STRATEGIC_REASONING: null,
    },
    assisted: true,
    hintsUsed: 2,
    metrics: { ...metrics, equity: 10250, totalReturnPct: 2.5, maxDrawdownPct: 3.1, maxWeightPct: 35 },
    strengths: ['You protected your largest position.'],
    improvements: [],
    calibration: {
      method: 'MARKET_ADJUSTED',
      orders: 3,
      observations: 3,
      minimumOrders: 10,
      interpretable: false,
      meanConfidence: 70,
      hitRate: 66.7,
      brierScore: 0.21,
      signals: [{ id: 'overconfident', orders: 2, detail: 'You rated two orders 90 % sure.' }],
    },
    countsTowardProfile: true,
    ...overrides,
  };
}

function timeline(overrides: Partial<Timeline> = {}): Timeline {
  return {
    sessionId: 's-1',
    kind: 'MISSION',
    status: 'COMPLETED',
    missionSlug: 'protect-your-capital',
    missionTitle: 'Protect Your Capital',
    canBranch: true,
    decisions: [
      { seq: 1, step: 0, type: 'PLACE_ORDER', summary: 'BUY 100 AAA market', rationale: 'LONG_TERM_VIEW', outcome: 'ACCEPTED', at: '2026-11-10T09:01:00.000Z' },
      { seq: 2, step: 1, type: 'REQUEST_HINT', summary: 'Asked the mentor', rationale: null, outcome: 'ACCEPTED', at: '2026-11-10T09:02:00.000Z' },
      { seq: 3, step: 1, type: 'PLACE_ORDER', summary: 'SELL 500 AAA market', rationale: 'TAKE_PROFIT', outcome: 'REJECTED', at: '2026-11-10T09:03:00.000Z' },
      { seq: 4, step: 1, type: 'ADVANCE', summary: 'Advance', rationale: null, outcome: 'ACCEPTED', at: '2026-11-10T09:04:00.000Z' },
    ],
    equityCurve: [
      { step: 0, equity: 10000 },
      { step: 10, equity: 10250 },
    ],
    news: [{ id: 'n-1', step: 2, headline: 'Alpha beats forecasts', sentiment: 'POSITIVE' }],
    branches: [
      { id: 'r-1', status: 'ACTIVE', branchFromSeq: 1, startedAt: '2026-11-10T10:00:00.000Z', assessment: null },
      { id: 'r-2', status: 'COMPLETED', branchFromSeq: 3, startedAt: '2026-11-10T11:00:00.000Z', assessment: { total: 65, passed: true } },
    ],
    ...overrides,
  };
}

function comparison(): Comparison {
  const compared = (id: string, kind: 'MISSION' | 'REPLAY', branchFromSeq: number | null, equity: number) => ({
    id,
    kind,
    status: 'COMPLETED' as const,
    branchFromSeq,
    countsTowardProfile: kind === 'MISSION',
    step: 10,
    decisions: kind === 'MISSION' ? 3 : 1,
    metrics: { ...metrics, equity, totalReturnPct: (equity / 10000 - 1) * 100 },
    assessment: kind === 'MISSION' ? { total: 72, passed: true, components: [] } : null,
    equityCurve: [
      { step: 0, equity: 10000 },
      { step: 10, equity },
    ],
  });
  return {
    missionSlug: 'protect-your-capital',
    missionTitle: 'Protect Your Capital',
    divergenceSeq: 3,
    note: 'Replays use exactly the same market path.',
    sessions: [compared('s-1', 'MISSION', null, 10250), compared('r-3', 'REPLAY', 3, 9800)],
  };
}

/* ---------------------------------------------------------------- harness */

let api: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  api = {
    missions: vi.fn().mockResolvedValue({ unlockedLevel: 'ROOKIE', missions: [summary()] }),
    mission: vi.fn().mockResolvedValue(briefing()),
    start: vi.fn(),
    session: vi.fn().mockResolvedValue(session()),
    command: vi.fn(),
    previewOrder: vi.fn(),
    abandon: vi.fn(),
    assessment: vi.fn().mockResolvedValue(assessment()),
    mentor: vi.fn(),
    timeline: vi.fn().mockResolvedValue(timeline()),
    branch: vi.fn(),
    compare: vi.fn().mockResolvedValue(comparison()),
  };
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle<T>(fixture: ComponentFixture<T>) {
  for (let i = 0; i < 4; i += 1) {
    await wait(0);
    await fixture.whenStable();
  }
}

async function render<T>(page: Type<T>, params: Record<string, string>) {
  const paramMap = convertToParamMap(params);
  TestBed.configureTestingModule({
    imports: [page],
    providers: [
      provideRouter([]),
      { provide: LearningApi, useValue: api },
      { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(page);
  await settle(fixture);
  return { fixture, root: fixture.nativeElement as HTMLElement, navigate };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** Text of each text node joined by spaces, so adjacent cells or definition terms read as separate words. */
const words = (el: Element | null | undefined) => {
  if (!el) return '';
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};
const button = (root: HTMLElement, name: string | RegExp) =>
  Array.from(root.querySelectorAll('button')).find((b) => (typeof name === 'string' ? text(b) === name : name.test(text(b))));
const link = (root: Element, name: string | RegExp) =>
  Array.from(root.querySelectorAll('a')).find((a) => (typeof name === 'string' ? text(a) === name : name.test(text(a))));
const panel = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`section#${id}`);

function setField(root: HTMLElement, selector: string, value: string, event: 'input' | 'change') {
  const field = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event(event));
}

/* ---------------------------------------------------------------- briefing */

describe('MissionBriefingPage', () => {
  it('shows the briefing, rules, objectives and scoring from the server', async () => {
    const { root } = await render(MissionBriefingPage, { slug: 'protect-your-capital' });
    expect(api['mission']).toHaveBeenCalledWith('protect-your-capital');
    expect(text(root.querySelector('nav[aria-label="Breadcrumb"]'))).toBe('MarketQuest / Mission briefing');
    expect(text(root.querySelector('h1'))).toBe('Protect Your Capital');
    expect(text(root.querySelector('.eyebrow'))).toBe('Trader débutant');
    const start = words(panel(root, 'start'));
    expect(start).toContain('Cash 9,000 DT');
    expect(start).toContain('10 trading days');
    expect(start).toContain('Alpha Bank 100 × AAA');
    expect(start).toContain('Tradable: AAA (Banking), BBB (Telecom).');
    const rules = text(panel(root, 'rules'));
    expect(rules).toContain('Order types: market, limit, stop.');
    expect(rules).toContain('Commission 0.25 % per fill, minimum 0.50 DT.');
    expect(rules).toContain('Buys above 40 % of equity in one asset are rejected.');
    expect(rules).toContain('The mission ends immediately if you lose 15 % of your starting value.');
    expect(words(panel(root, 'objectives'))).toContain('Protect a position Optional');
    expect(panel(root, 'scoring')?.querySelector('[role="meter"][aria-label="Risk management weight"]')?.getAttribute('aria-valuenow')).toBe('40');
    expect(text(panel(root, 'scoring'))).toContain('Competencies: Risk Management, Trading Execution.');
    expect(root.querySelector<HTMLInputElement>('#mentor-mode-GUIDED')?.checked).toBe(true);
    expect(text(root.querySelector('label[for="mentor-mode-GUIDED"]'))).toContain('Guided (default for this mission)');
    expect(link(root, 'Open the FinStory')?.getAttribute('href')).toBe('/stories?story=sarah-and-the-market-crash');
  });

  it('starts the mission with the chosen mentor style and opens the player', async () => {
    api['start'].mockResolvedValue({ resumed: false, session: session({ id: 'new-1' }) });
    const { fixture, root, navigate } = await render(MissionBriefingPage, { slug: 'protect-your-capital' });
    root.querySelector<HTMLInputElement>('#mentor-mode-SOCRATIC')!.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    button(root, 'Start mission')!.click();
    await settle(fixture);
    expect(api['start']).toHaveBeenCalledWith('protect-your-capital', 'SOCRATIC');
    expect(navigate).toHaveBeenCalledWith('/learn/sessions/new-1');
  });

  it('offers to resume an attempt in progress and locks the mentor style', async () => {
    api['missions'].mockResolvedValue({ unlockedLevel: 'ROOKIE', missions: [summary({ progress: { attempts: 1, passed: false, bestScore: null, activeSessionId: 's-9' } })] });
    const { root } = await render(MissionBriefingPage, { slug: 'protect-your-capital' });
    expect(link(root, 'Resume mission')?.getAttribute('href')).toBe('/learn/sessions/s-9');
    expect(button(root, 'Start mission')).toBeUndefined();
    expect(root.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
    expect(root.textContent).toContain('Your attempt in progress keeps the style you chose when you started.');
  });

  it('never offers to start a planned mission', async () => {
    api['mission'].mockResolvedValue(briefing({ availability: 'PLANNED' }));
    api['missions'].mockResolvedValue({ unlockedLevel: 'ROOKIE', missions: [summary({ availability: 'PLANNED', playable: false })] });
    const { root } = await render(MissionBriefingPage, { slug: 'protect-your-capital' });
    expect(button(root, 'Not playable yet')?.disabled).toBe(true);
  });

  it('reports load and start failures honestly', async () => {
    api['start'].mockRejectedValue(new ApiError(409, 'Mission locked.'));
    const ok = await render(MissionBriefingPage, { slug: 'protect-your-capital' });
    button(ok.root, 'Start mission')!.click();
    await settle(ok.fixture);
    expect(text(ok.root.querySelector('.form-error-banner'))).toBe('Mission locked.');
    expect(button(ok.root, 'Start mission')?.disabled).toBe(false);
    TestBed.resetTestingModule();

    api['mission'].mockRejectedValue(new ApiError(404, 'Mission not found.'));
    const { root } = await render(MissionBriefingPage, { slug: 'nope' });
    expect(text(root.querySelector('.form-error-banner'))).toBe('Mission not found.');
    expect(text(root.querySelector('.ws-empty[data-tone="error"]'))).toContain('Mission unavailable');
    expect(link(root, 'Back to MarketQuest')?.getAttribute('href')).toBe('/learn');
  });
});

/* ---------------------------------------------------------------- player */

describe('MissionPlayerPage', () => {
  it('shows the market, portfolio, orders, news and objectives up to the current step', async () => {
    const { root } = await render(MissionPlayerPage, { id: 's-1' });
    expect(api['session']).toHaveBeenCalledWith('s-1');
    const toolbar = root.querySelector('[aria-label="Mission controls"]')!;
    expect(text(toolbar)).toContain('Day 2 of 10');
    expect(text(toolbar)).toContain('10,000.00 DT');
    expect(text(toolbar.querySelector('.badge'))).toBe('Loss limit 15 % · used 0.0 %');
    expect(root.querySelector('#chart figure svg')?.getAttribute('aria-label')).toBe('AAA mid price from 2 days before the mission to day 2.');
    expect(text(panel(root, 'chart')?.querySelector('.ws-panelTitle'))).toBe('AAA · Alpha Bank');
    expect(text(panel(root, 'chart')?.querySelector('.ch-legend'))).toContain('Your average cost');
    expect(root.querySelector('.lr-quoteRow[data-selected="true"]')?.textContent).toContain('AAA');
    expect(words(panel(root, 'quotes')?.querySelector('tbody tr'))).toContain('AAA Banking 9.990 10.010 20 bp 1,200');
    expect(text(panel(root, 'positions')?.querySelector('.ws-panelDescription'))).toBe('Cash 9,000.00 DT · reserved for open buys 195.00 DT');
    const orders = panel(root, 'orders')!.querySelectorAll('tbody tr');
    expect(words(orders[0])).toContain('Buy 10 BBB · limit 0/10 ≤ 19.500 open Diversify');
    expect(button(orders[0] as HTMLElement, 'Annuler')).toBeDefined();
    expect(button(orders[1] as HTMLElement, 'Annuler')).toBeUndefined();
    expect(root.querySelector('.lr-news[data-fresh="true"]')?.textContent).toContain('Alpha beats forecasts');
    expect(words(panel(root, 'objectives'))).toContain('Keep drawdown under 8 % On track · Drawdown 1.2 %');
    expect(words(panel(root, 'risk'))).toContain('1-day VaR 95 % 42 DT');
    expect(text(panel(root, 'mentor')?.querySelector('.lr-source'))).toBe('Rule-based · no AI provider');
    expect(root.textContent).toContain('Fictional deterministic scenario.');
  });

  it('previews an order on the server, places it with the expected sequence and resets the ticket', async () => {
    api['previewOrder'].mockResolvedValue({ seq: 2, accepted: true, code: null, message: null, estimate: { price: 10.01, notional: 100.1, fee: 0.5, total: 100.6 }, warnings: ['Thin depth.'] });
    api['command'].mockResolvedValue({
      replayed: false,
      outcome: 'ACCEPTED',
      message: 'Bought 10 AAA at 10.010 DT.',
      session: session({ lastSeq: 3 }, { step: 2 }),
    });
    const { fixture, root } = await render(MissionPlayerPage, { id: 's-1' });
    const ticket = root.querySelector<HTMLFormElement>('form.lr-ticket')!;
    expect(words(ticket.querySelector('#ticket-preview'))).toContain('Estimated price —');
    setField(root, '#ticket-qty', ' 10 ', 'input');
    setField(root, '#ticket-rationale', 'LONG_TERM_VIEW', 'change');
    await fixture.whenStable();
    expect(root.querySelector<HTMLInputElement>('#ticket-qty')!.value).toBe('10');
    await wait(300);
    await settle(fixture);
    expect(api['previewOrder']).toHaveBeenCalledWith('s-1', { type: 'PLACE_ORDER', symbol: 'AAA', side: 'BUY', orderType: 'MARKET', quantity: 10, rationale: 'LONG_TERM_VIEW' });
    const preview = words(ticket.querySelector('#ticket-preview'));
    expect(preview).toContain('Estimated price 10.010 DT');
    expect(preview).toContain('Estimated cost 100.60 DT');
    expect(preview).toContain('Available cash 8,805.00 DT');
    expect(ticket.textContent).toContain('Thin depth.');

    ticket.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(api['command']).toHaveBeenCalledWith('s-1', {
      idempotencyKey: expect.any(String),
      expectedSeq: 2,
      command: { type: 'PLACE_ORDER', symbol: 'AAA', side: 'BUY', orderType: 'MARKET', quantity: 10, rationale: 'LONG_TERM_VIEW' },
    });
    expect(text(root.querySelector('.lr-toast'))).toBe('Bought 10 AAA at 10.010 DT.');
    expect(root.querySelector('.lr-toast')?.getAttribute('role')).toBe('status');
    expect(root.querySelector<HTMLInputElement>('#ticket-qty')!.value).toBe('');
  });

  it('lists form errors and blocks orders the server preview refuses', async () => {
    api['previewOrder'].mockResolvedValue({ seq: 2, accepted: false, code: 'INSUFFICIENT_CASH', message: 'Not enough cash for this order.', estimate: null, warnings: [] });
    const { fixture, root } = await render(MissionPlayerPage, { id: 's-1' });
    const ticket = root.querySelector<HTMLFormElement>('form.lr-ticket')!;
    ticket.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    const errors = Array.from(ticket.querySelectorAll('ul.field-error li')).map((li) => li.textContent);
    expect(errors).toEqual(['Enter a whole number of shares (at least 1).', 'Say why you are placing this order.']);
    expect(root.querySelector('#ticket-rationale')?.getAttribute('aria-invalid')).toBe('true');

    setField(root, '#ticket-qty', '5000', 'input');
    setField(root, '#ticket-rationale', 'REACT_TO_NEWS', 'change');
    await wait(300);
    await settle(fixture);
    expect(text(ticket.querySelector('#ticket-preview .field-error'))).toBe('Not enough cash for this order.');
    ticket.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(api['command']).not.toHaveBeenCalled();
  });

  it('says when the order check is unavailable', async () => {
    api['previewOrder'].mockRejectedValue(new TypeError('Failed to fetch'));
    const { fixture, root } = await render(MissionPlayerPage, { id: 's-1' });
    setField(root, '#ticket-qty', '1', 'input');
    setField(root, '#ticket-rationale', 'DIVERSIFY', 'change');
    await wait(300);
    await settle(fixture);
    expect(root.textContent).toContain('The order check is unavailable right now.');
  });

  it('prefills a protective stop from a position', async () => {
    const { fixture, root } = await render(MissionPlayerPage, { id: 's-1' });
    button(panel(root, 'positions')!, 'Protect')!.click();
    await fixture.whenStable();
    expect(root.querySelector<HTMLSelectElement>('#ticket-type')!.value).toBe('STOP');
    expect(root.querySelector<HTMLInputElement>('#ticket-price')!.value).toBe('9.490');
    expect(root.querySelector<HTMLInputElement>('#ticket-qty')!.value).toBe('100');
    expect(root.querySelector<HTMLSelectElement>('#ticket-rationale')!.value).toBe('LIMIT_DOWNSIDE');
    expect(button(root.querySelector('form.lr-ticket')!, 'Buy')?.disabled).toBe(true);
    expect(text(root.querySelector('form.lr-ticket button[type="submit"]'))).toBe('Place sell order');
  });

  it('advances the market and reloads after a sequence conflict', async () => {
    api['command'].mockResolvedValueOnce({ replayed: false, outcome: 'ACCEPTED', message: 'Day 3.', session: session({ lastSeq: 3 }, { step: 3 }) });
    const { fixture, root } = await render(MissionPlayerPage, { id: 's-1' });
    button(root, /^Next day/)!.click();
    await settle(fixture);
    expect(api['command']).toHaveBeenCalledWith('s-1', expect.objectContaining({ expectedSeq: 2, command: { type: 'ADVANCE' } }));
    expect(text(root.querySelector('[aria-label="Mission controls"]'))).toContain('Day 3 of 10');

    api['command'].mockRejectedValueOnce(new ApiError(409, 'This mission changed in another tab.', 'SEQUENCE_CONFLICT'));
    api['session'].mockResolvedValue(session({ lastSeq: 5 }, { step: 4 }));
    button(root, /^Next day/)!.click();
    await settle(fixture);
    expect(api['command']).toHaveBeenLastCalledWith('s-1', expect.objectContaining({ expectedSeq: 3 }));
    expect(text(root.querySelector('[aria-label="Mission controls"]'))).toContain('Day 4 of 10');
    const toast = root.querySelector('.lr-toast')!;
    expect(toast.getAttribute('data-tone')).toBe('amber');
    expect(text(toast)).toBe('This mission changed in another tab. The latest state is shown.');
  });

  it('asks the rule-based mentor with the chosen style', async () => {
    api['mentor'].mockResolvedValue({
      mentor: {
        mode: 'SOCRATIC',
        source: 'RULE_BASED',
        sourceLabel: 'Rule-based mentor',
        topic: 'Concentration',
        message: 'What happens if Alpha falls 20 %?',
        questions: ['How much could you lose?'],
        evidence: ['AAA is 10 % of equity.'],
        ruleId: 'concentration',
      },
      session: session({ assisted: true }, { hintsUsed: 1 }),
    });
    const { fixture, root } = await render(MissionPlayerPage, { id: 's-1' });
    setField(root, '#mentor-mode', 'SOCRATIC', 'change');
    button(root, 'Ask')!.click();
    await settle(fixture);
    expect(api['mentor']).toHaveBeenCalledWith('s-1', 'SOCRATIC');
    const mentor = text(panel(root, 'mentor'));
    expect(mentor).toContain('Rule-based mentor · Concentration');
    expect(mentor).toContain('What happens if Alpha falls 20 %?');
    expect(mentor).toContain('Based on');
    expect(mentor).toContain('Mentor used 1 time(s) in this attempt.');
    expect(text(root.querySelector('[aria-label="Mission controls"]'))).toContain('Assisted');
  });

  it('runs a stress test and lists the newest result first', async () => {
    const tests = [
      { scenarioId: 'crash', name: 'Market crash', step: 1, impact: -150, impactPct: -1.5, breakdown: [] },
      { scenarioId: 'crash', name: 'Market crash', step: 2, impact: -200, impactPct: -2, breakdown: [] },
    ];
    api['command'].mockResolvedValue({ replayed: false, outcome: 'ACCEPTED', message: 'Stress test run.', session: session({ lastSeq: 3 }, { stressTests: tests }) });
    const { fixture, root } = await render(MissionPlayerPage, { id: 's-1' });
    button(panel(root, 'stress')!, 'Run')!.click();
    await settle(fixture);
    expect(api['command']).toHaveBeenCalledWith('s-1', expect.objectContaining({ command: { type: 'RUN_STRESS_TEST', scenarioId: 'crash' } }));
    const results = Array.from(panel(root, 'stress')!.querySelectorAll('li.lr-preview')).map(words);
    expect(results[0]).toContain('Day 2 Estimated impact −200.00 DT (-2.0 %)');
    expect(results[1]).toContain('Day 1');
  });

  it('abandons only after confirmation and then opens the Time Machine', async () => {
    api['abandon'].mockResolvedValue(session({ status: 'ABANDONED' }));
    const { fixture, root } = await render(MissionPlayerPage, { id: 's-1' });
    button(root, 'Abandon')!.click();
    await fixture.whenStable();
    expect(root.textContent).toContain('Abandon this attempt? It will not be assessed.');
    button(root, 'Keep playing')!.click();
    await fixture.whenStable();
    expect(button(root, 'Yes, abandon')).toBeUndefined();
    button(root, 'Abandon')!.click();
    await fixture.whenStable();
    button(root, 'Yes, abandon')!.click();
    await settle(fixture);
    expect(api['abandon']).toHaveBeenCalledWith('s-1');
    expect(text(root.querySelector('.lr-banner'))).toBe('Mission abandoned.');
    expect(link(root, 'Open the Time Machine')?.getAttribute('href')).toBe('/learn/sessions/s-1/review');
    expect(root.querySelector<HTMLButtonElement>('form.lr-ticket button[type="submit"]')?.disabled).toBe(true);
    expect(text(panel(root, 'ticket')?.querySelector('.ws-panelDescription'))).toBe('This mission has ended.');
  });

  it('shows the finish step when the market has closed and the result once completed', async () => {
    api['session'].mockResolvedValue(session({}, { marketClosed: true, step: 10 }));
    api['command'].mockResolvedValue({
      replayed: false,
      outcome: 'ACCEPTED',
      message: 'Mission complete.',
      session: session({ status: 'COMPLETED', lastSeq: 3 }, { marketClosed: true, step: 10, status: 'COMPLETED' }),
    });
    const { fixture, root } = await render(MissionPlayerPage, { id: 's-1' });
    expect(root.textContent).toContain('The market has closed for this mission.');
    expect(link(root, 'Order ticket')).toBeUndefined();
    button(root, 'Finish and get assessed')!.click();
    await settle(fixture);
    expect(api['command']).toHaveBeenCalledWith('s-1', expect.objectContaining({ command: { type: 'FINISH' } }));
    const banner = root.querySelector('.lr-banner')!;
    expect(banner.getAttribute('data-tone')).toBe('pos');
    expect(text(banner)).toBe('Mission complete. Your decisions have been assessed.');
    expect(link(root, 'See your assessment')?.getAttribute('href')).toBe('/learn/sessions/s-1/review');
  });

  it('shows an error state when the session cannot be loaded', async () => {
    api['session'].mockRejectedValue(new ApiError(404, 'Session not found.'));
    const { root } = await render(MissionPlayerPage, { id: 'missing' });
    const empty = root.querySelector('.ws-empty[data-tone="error"]');
    expect(text(empty)).toContain('Mission unavailable');
    expect(text(empty)).toContain('Session not found.');
    expect(link(root, 'Back to MarketQuest')?.getAttribute('href')).toBe('/learn');
  });
});

/* ---------------------------------------------------------------- review + Time Machine */

describe('SessionReviewPage', () => {
  beforeEach(() => {
    api['session'].mockResolvedValue(session({ status: 'COMPLETED' }, { status: 'COMPLETED', step: 10 }));
  });

  it('explains the assessment with evidence, objectives, competencies and calibration', async () => {
    const { root } = await render(SessionReviewPage, { id: 's-1' });
    expect(api['assessment']).toHaveBeenCalledWith('s-1');
    expect(text(root.querySelector('nav[aria-label="Breadcrumb"]'))).toBe('MarketQuest / Protect Your Capital / Review');
    const score = root.querySelector('.ws-kpi')!;
    expect(score.getAttribute('data-tone')).toBe('positive');
    expect(text(score.querySelector('.ws-kpiValue'))).toBe('72Passed');
    expect(text(score.querySelector('.ws-kpiHint'))).toBe('Pass mark 60');
    expect(text(root.querySelectorAll('.ws-kpi')[3].querySelector('.ws-kpiValue'))).toBe('2 hint(s)');
    const risk = root.querySelector('section[aria-label="Risk management"]')!;
    expect(text(risk.querySelector('.num'))).toBe('80 / 100 · weight 50 % (configured 40 %)');
    expect(text(risk.querySelector('li'))).toBe('Drawdown (82): Max drawdown 3.1 %.');
    expect(text(root.querySelector('section[aria-label="Reasoning"] .num'))).toBe('Not judged · weight 0 % (configured 20 %)');
    expect(text(panel(root, 'objectives'))).toContain('Met · Drawdown 3.1 %');
    expect(words(panel(root, 'competency-evidence'))).toContain('Trading Execution 65');
    expect(words(panel(root, 'competency-evidence'))).toContain('Market Understanding Not observed');
    expect(text(panel(root, 'improvements'))).toContain('Nothing major to improve.');
    const calibration = words(panel(root, 'calibration'));
    expect(calibration).toContain('Average confidence 70 %');
    expect(calibration).toContain('Beat the market by the end 67 %');
    expect(calibration).toContain('Brier score 0.210');
    expect(calibration).toContain('3 outcome(s) compared. At least 10 are needed');
    expect(calibration).toContain('You rated two orders 90 % sure.');
  });

  it('loads the rule-based debrief on request', async () => {
    api['mentor'].mockResolvedValue({
      mentor: { mode: 'DEBRIEF', source: 'RULE_BASED', sourceLabel: 'Rule-based debrief', topic: 'Risk', message: 'You kept losses small.', questions: [], evidence: [], ruleId: 'debrief' },
      session: session({ status: 'COMPLETED' }),
    });
    const { fixture, root } = await render(SessionReviewPage, { id: 's-1' });
    button(root, 'Show debrief')!.click();
    await settle(fixture);
    expect(api['mentor']).toHaveBeenCalledWith('s-1', 'DEBRIEF');
    expect(words(panel(root, 'debrief'))).toContain('Rule-based debrief · Risk You kept losses small.');
    expect(button(root, 'Show debrief')).toBeUndefined();
  });

  it('lists decisions without mentor requests and rewinds with "do nothing more" into a comparison', async () => {
    api['branch'].mockResolvedValue(session({ id: 'r-3', kind: 'REPLAY', status: 'COMPLETED', parentSessionId: 's-1', branchFromSeq: 3 }));
    const { fixture, root } = await render(SessionReviewPage, { id: 's-1' });
    const items = Array.from(root.querySelectorAll('.lr-timeline li'));
    expect(items.map((li) => words(li))).toEqual([
      'Day 0 · BUY 100 AAA market · Long-term view #1',
      'Day 1 · SELL 500 AAA market · Take profit · rejected #3',
      'Day 1 · Advance #4',
    ]);
    expect(items[1].getAttribute('data-outcome')).toBe('REJECTED');
    expect(button(root, /Select a decision to rewind/)?.disabled).toBe(true);

    items[1].querySelector<HTMLInputElement>('input[type="radio"]')!.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(items[1].getAttribute('data-selected')).toBe('true');
    button(root, /Rewind to decision #3/)!.click();
    await settle(fixture);
    expect(api['branch']).toHaveBeenCalledWith('s-1', 3, 'HOLD');
    expect(api['session']).toHaveBeenCalledTimes(2);
    expect(api['timeline']).toHaveBeenCalledTimes(2);
    expect(api['compare']).toHaveBeenCalledWith('s-1', 'r-3');
    const compare = panel(root, 'comparison')!;
    const cells = Array.from(compare.querySelectorAll('[role="row"]')).map((row) => Array.from(row.children).map(text));
    expect(cells[0]).toEqual(['Measure', 'Original attempt', 'Replay from decision 3']);
    expect(cells[2]).toEqual(['Score', '72 · passed', 'Not assessed']);
    expect(cells[3]).toEqual(['Final value', '10,250.00 DT', '9,800.00 DT']);
    expect(text(compare.querySelector('p.lr-muted'))).toBe('The paths split at decision 3. Replays use exactly the same market path.');
  });

  it('opens the player when replaying manually', async () => {
    api['branch'].mockResolvedValue(session({ id: 'r-9', kind: 'REPLAY', status: 'ACTIVE', parentSessionId: 's-1', branchFromSeq: 1 }));
    const { fixture, root, navigate } = await render(SessionReviewPage, { id: 's-1' });
    root.querySelector<HTMLInputElement>('.lr-timeline input[value="1"]')!.dispatchEvent(new Event('change'));
    setField(root, '#branch-strategy', 'MANUAL', 'change');
    await fixture.whenStable();
    button(root, /Rewind to decision #1/)!.click();
    await settle(fixture);
    expect(api['branch']).toHaveBeenCalledWith('s-1', 1, 'MANUAL');
    expect(navigate).toHaveBeenCalledWith('/learn/sessions/r-9');
    expect(api['compare']).not.toHaveBeenCalled();
  });

  it('lists existing replays with continue and compare actions', async () => {
    const { fixture, root } = await render(SessionReviewPage, { id: 's-1' });
    const replays = Array.from(root.querySelectorAll('#time-machine .lr-spread'));
    expect(text(replays[0])).toContain('From decision #1 · active');
    expect(link(replays[0], 'Continue')?.getAttribute('href')).toBe('/learn/sessions/r-1');
    expect(text(replays[1])).toContain('From decision #3 · completed · score 65');
    expect(link(replays[1], 'Continue')).toBeUndefined();
    button(replays[1] as HTMLElement, 'Compare')!.click();
    await settle(fixture);
    expect(api['compare']).toHaveBeenCalledWith('s-1', 'r-2');
    expect(panel(root, 'comparison')).not.toBeNull();
  });

  it('keeps the Time Machine closed while the mission is in progress', async () => {
    api['session'].mockResolvedValue(session());
    api['timeline'].mockResolvedValue(timeline({ status: 'ACTIVE', canBranch: false, branches: [] }));
    const { root } = await render(SessionReviewPage, { id: 's-1' });
    expect(api['assessment']).not.toHaveBeenCalled();
    expect(root.textContent).toContain('This mission is still in progress.');
    expect(link(root, 'Resume mission')?.getAttribute('href')).toBe('/learn/sessions/s-1');
    expect(root.querySelector<HTMLFieldSetElement>('#time-machine fieldset')?.disabled).toBe(true);
    expect(root.querySelector('#branch-strategy')).toBeNull();
  });

  it('treats an assessment that is not ready as absent and explains abandoned attempts', async () => {
    api['session'].mockResolvedValue(session({ status: 'ABANDONED' }));
    const abandoned = await render(SessionReviewPage, { id: 's-1' });
    expect(abandoned.root.textContent).toContain('This attempt was abandoned, so it was not assessed.');
    expect(link(abandoned.root, 'Réessayer')?.getAttribute('href')).toBe('/learn/missions/protect-your-capital');
    TestBed.resetTestingModule();

    api['session'].mockResolvedValue(session({ status: 'FAILED' }));
    api['assessment'].mockRejectedValue(new ApiError(409, 'Not ready.', 'ASSESSMENT_NOT_READY'));
    const { root } = await render(SessionReviewPage, { id: 's-1' });
    expect(root.querySelector('.ws-empty[data-tone="error"]')).toBeNull();
    expect(root.querySelector('.lr-kpis')).toBeNull();
    expect(panel(root, 'time-machine')).not.toBeNull();
  });

  it('compares a replay with its original attempt', async () => {
    api['session'].mockResolvedValue(session({ id: 'r-2', kind: 'REPLAY', status: 'COMPLETED', parentSessionId: 's-1', branchFromSeq: 3, countsTowardProfile: false }));
    api['assessment'].mockResolvedValue(assessment({ countsTowardProfile: false }));
    const { fixture, root } = await render(SessionReviewPage, { id: 'r-2' });
    expect(text(root.querySelector('.eyebrow'))).toBe('Time Machine replay · practice only');
    expect(text(panel(root, 'competency-evidence')?.querySelector('.ws-panelDescription'))).toBe('Practice replay: not added to your profile.');
    button(root, 'Compare with original')!.click();
    await settle(fixture);
    expect(api['compare']).toHaveBeenCalledWith('r-2', 's-1');
  });

  it('shows load and action failures honestly', async () => {
    api['compare'].mockRejectedValue(new ApiError(422, 'Only sessions of the same mission version can be compared.', 'NOT_COMPARABLE'));
    const ok = await render(SessionReviewPage, { id: 's-1' });
    button(ok.root.querySelectorAll<HTMLElement>('#time-machine .lr-spread')[1], 'Compare')!.click();
    await settle(ok.fixture);
    expect(text(ok.root.querySelector('.form-error-banner'))).toBe('Only sessions of the same mission version can be compared.');
    TestBed.resetTestingModule();

    api['timeline'].mockRejectedValue(new ApiError(404, 'Session not found.'));
    const { root } = await render(SessionReviewPage, { id: 'missing' });
    expect(text(root.querySelector('.ws-empty[data-tone="error"]'))).toContain('Review unavailable');
    expect(link(root, 'Back to MarketQuest')?.getAttribute('href')).toBe('/learn');
  });
});
