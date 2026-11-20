import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../api/api-client';

export type EvidenceKind = 'OBSERVED' | 'CALCULATED' | 'MODEL' | 'ASSUMPTION' | 'SIMULATION' | 'INTERPRETATION';
export type EchoStatus = 'COMPLETE' | 'PARTIAL' | 'NO_DATA' | 'CLARIFICATION' | 'REFUSED' | 'ERROR';
export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface EchoEvidence {
  kind: EvidenceKind;
  kindLabel: string;
  label: string;
  value: unknown;
  unit: string | null;
  source: string | null;
}

export interface EchoAction {
  kind: 'ASK' | 'NAVIGATE';
  label: string;
  question?: string;
  route?: string;
}

export interface EchoRiskFlag {
  code: string;
  severity: Severity;
  message: string;
  basis: Record<string, unknown> | null;
}

export interface EchoChart {
  type: 'line' | 'bar';
  title: string;
  unit: string | null;
  points: { x: string | number; y: number }[];
}

export interface EchoScenario {
  kind: string;
  hypothetical: boolean;
  label: string;
  rows: Record<string, unknown>[];
  assumptions?: string[];
}

export interface EchoSource {
  module: string;
  method: string;
  provenance: Record<string, unknown> | null;
}

export interface EchoAnswer {
  intent: string;
  status: EchoStatus;
  answer: string;
  speech: string | null;
  context: Record<string, unknown>;
  evidence: EchoEvidence[];
  dataAsOf: string | null;
  riskFlags: EchoRiskFlag[];
  suggestedActions: EchoAction[];
  visualization: EchoChart | null;
  scenario: EchoScenario | null;
  clarification: { question: string; options: { label: string; message?: string; context?: Record<string, unknown> }[] } | null;
  limitations: string[];
  sources: EchoSource[];
  toolsUsed: string[];
  engine: string;
}

export interface EchoOrderDraft {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
}

export interface EchoClientContext {
  route?: string;
  module?: string;
  symbol?: string | null;
  portfolioId?: string | null;
  sessionId?: string | null;
  storySlug?: string | null;
  actuarialScenarioId?: string | null;
  stressPresetId?: string | null;
  orderDraft?: EchoOrderDraft | null;
}

export interface EchoAskResponse {
  conversationId: string;
  title: string;
  message: EchoAnswer;
}

export interface EchoMessage {
  role: 'USER' | 'ECHO';
  content: string;
  intent: string | null;
  payload: EchoAnswer | { context: unknown } | null;
  createdAt: string;
}

export interface EchoPreferences {
  memoryEnabled: boolean;
  voiceEnabled: boolean;
  proactiveVoice: boolean;
  alertsEnabled: boolean;
  helpLevel: 'DEBUTANT' | 'INTERMEDIAIRE' | 'AVANCE';
}

export interface EchoDecision {
  id: string;
  portfolioId: string | null;
  symbol: string | null;
  side: 'BUY' | 'SELL' | null;
  quantity: number | null;
  intent: string;
  intentNote: string | null;
  hypothesis: string | null;
  snapshot: Record<string, unknown>;
  status: 'OPEN' | 'REVIEWED';
  observation: string | null;
  review: { at: string; answer: EchoAnswer } | null;
  createdAt: string;
}

export interface EchoAlert {
  id: string;
  code: string;
  severity: Severity;
  title: string;
  message: string;
  evidence: Record<string, unknown>;
  action: { label: string; route: string } | null;
  status: string;
  read: boolean;
  createdAt: string;
}

export interface EchoAlertPoll {
  alertsEnabled: boolean;
  proactiveVoice: boolean;
  evaluated: boolean;
  raised: string[];
  alerts: EchoAlert[];
}

@Injectable({ providedIn: 'root' })
export class EchoApi {
  private readonly api = inject(ApiClient);

  ask(message: string, context: EchoClientContext, conversationId: string | null): Promise<EchoAskResponse> {
    return this.api.request('/echo/ask', { method: 'POST', body: { message, context, conversationId } });
  }

  preTrade(portfolioId: string, orderDraft: EchoOrderDraft): Promise<EchoAnswer> {
    return this.api.request('/echo/pretrade', { method: 'POST', body: { portfolioId, orderDraft } });
  }

  conversations(): Promise<{ conversations: { id: string; title: string; updatedAt: string; messages: number }[] }> {
    return this.api.request('/echo/conversations', { method: 'GET' });
  }

  conversation(id: string): Promise<{ id: string; title: string; messages: EchoMessage[] }> {
    return this.api.request(`/echo/conversations/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  deleteConversation(id: string): Promise<void> {
    return this.api.request(`/echo/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  deleteConversations(): Promise<{ deleted: number }> {
    return this.api.request('/echo/conversations', { method: 'DELETE' });
  }

  preferences(): Promise<EchoPreferences> {
    return this.api.request('/echo/preferences', { method: 'GET' });
  }

  savePreferences(p: Partial<EchoPreferences>): Promise<EchoPreferences> {
    return this.api.request('/echo/preferences', { method: 'PUT', body: p });
  }

  decisions(): Promise<{ memoryEnabled: boolean; intents: { id: string; label: string }[]; decisions: EchoDecision[] }> {
    return this.api.request('/echo/decisions', { method: 'GET' });
  }

  createDecision(body: Record<string, unknown>): Promise<EchoDecision> {
    return this.api.request('/echo/decisions', { method: 'POST', body });
  }

  updateDecision(id: string, body: Record<string, unknown>): Promise<EchoDecision> {
    return this.api.request(`/echo/decisions/${encodeURIComponent(id)}`, { method: 'PATCH', body });
  }

  reviewDecision(id: string): Promise<{ decision: EchoDecision; review: EchoAnswer }> {
    return this.api.request(`/echo/decisions/${encodeURIComponent(id)}/review`, { method: 'POST' });
  }

  deleteDecision(id: string): Promise<void> {
    return this.api.request(`/echo/decisions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  alerts(force = false): Promise<EchoAlertPoll> {
    return this.api.request(`/echo/alerts${force ? '?force=true' : ''}`, { method: 'GET' });
  }

  markRead(id: string): Promise<void> {
    return this.api.request(`/echo/alerts/${encodeURIComponent(id)}/read`, { method: 'POST' });
  }

  dismiss(id: string): Promise<void> {
    return this.api.request(`/echo/alerts/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
  }
}
