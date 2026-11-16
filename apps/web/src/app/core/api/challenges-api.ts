import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

export interface ChallengeSummary {
  id: string;
  title: string;
  description: string;
  startingCapital: number;
  open: boolean;
  createdAt: string;
  currency: string;
}

export interface ChallengeDetail extends ChallengeSummary {
  ranking: { displayName: string; scorePct: number; finalEquity: number; submittedAt: string | null }[];
  participants: number;
}

@Injectable({ providedIn: 'root' })
export class ChallengesApi {
  private readonly api = inject(ApiClient);

  list(): Promise<{ challenges: ChallengeSummary[]; note: string }> {
    return this.api.request('/challenges', { method: 'GET' });
  }

  detail(id: string): Promise<ChallengeDetail> {
    return this.api.request(`/challenges/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  join(id: string): Promise<ChallengeDetail> {
    return this.api.request(`/challenges/${encodeURIComponent(id)}/join`, { method: 'POST', body: {} });
  }

  submit(id: string, finalEquity: number): Promise<ChallengeDetail> {
    return this.api.request(`/challenges/${encodeURIComponent(id)}/submit`, { method: 'POST', body: { finalEquity } });
  }

  create(input: { title: string; description?: string; startingCapital?: number }): Promise<ChallengeSummary> {
    return this.api.request('/challenges', { method: 'POST', body: input });
  }
}