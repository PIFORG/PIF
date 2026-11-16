import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

export interface AiOverview {
  title: string;
  disclaimer: string;
  models: { id: string; title: string; testR2: number }[];
  capabilities: string[];
}

export interface AiInsight {
  id: string;
  kind: string;
  title: string;
  detail: string;
  confidence: number;
  modelId: string | null;
  hasExplanation: boolean;
  day?: string;
}

export interface AiInsightsResponse {
  insights: AiInsight[];
  sentimentFeed: {
    headline: string;
    score: number;
    label: string;
    tokens: string[];
    source: string;
    note: string;
  }[];
  agent: { action: string; confidence: number; predictedReturn: number; rationale: string; humanInTheLoop: boolean };
  disclaimer: string;
}

export interface AiExplanation {
  insightId: string;
  modelId: string;
  method: string;
  prediction: number;
  baseline: number;
  sumContributions: number;
  identityCheck: boolean;
  contributions: { feature: string; value: number; contribution: number; direction: string }[];
  summary: string;
  limitations: string[];
}

export interface AiModelCard {
  id: string;
  title: string;
  method: string;
  dataProvenance: string;
  split: { train: number; validation: number; test: number; protocol: string };
  metrics: {
    train: { rmse: number; mae: number; r2: number; n: number };
    validation: { rmse: number; mae: number; r2: number; n: number };
    test: { rmse: number; mae: number; r2: number; n: number };
    baselineMeanTest: { rmse: number; mae: number; r2: number; n: number };
  };
  globalImportance: { feature: string; importanceMean: number; importanceStd: number }[];
  limitations: string[];
}

@Injectable({ providedIn: 'root' })
export class AiApi {
  private readonly api = inject(ApiClient);

  overview(): Promise<AiOverview> {
    return this.api.request('/ai', { method: 'GET' });
  }

  insights(): Promise<AiInsightsResponse> {
    return this.api.request('/ai/insights', { method: 'GET' });
  }

  explanation(id: string): Promise<AiExplanation> {
    return this.api.request(`/ai/insights/${encodeURIComponent(id)}/explanation`, { method: 'GET' });
  }

  model(id: string): Promise<AiModelCard> {
    return this.api.request(`/ai/models/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  importance(id: string): Promise<{ modelId: string; features: AiModelCard['globalImportance']; note: string }> {
    return this.api.request(`/ai/models/${encodeURIComponent(id)}/importance`, { method: 'GET' });
  }
}
