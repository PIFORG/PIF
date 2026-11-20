import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

export interface RoomSummary {
  id: string;
  code: string;
  title: string;
  description: string;
  visibility: string;
  mode: string;
  status: string;
  marketScope: string;
  crisisEpisodeId?: string | null;
  simClockDate?: string | null;
  participantCount: number;
  maxParticipants: number;
  eventSeq: number;
  createdAt: string;
}

export interface RoomMemberPublic {
  displayName: string;
  role: string;
  level: string;
  learningPoints: number;
  tradingLocked: boolean;
  joinedAt: string;
}

export interface RoomDetail extends RoomSummary {
  rules: Record<string, unknown>;
  members: RoomMemberPublic[];
  leaderboard: Record<string, unknown>[];
  scoreExplanation?: { fr?: string; weights?: Record<string, number> };
  you: Record<string, unknown> | null;
  isHost: boolean;
  canModerate: boolean;
  market: Record<string, unknown>;
  voice: { available: boolean; reason: string };
  recoveryHints: string[];
}

@Injectable({ providedIn: 'root' })
export class RoomsApi {
  private readonly api = inject(ApiClient);

  list(): Promise<{ rooms: RoomSummary[]; onboarding: Record<string, unknown>; disclaimer: string }> {
    return this.api.request('/rooms', { method: 'GET' });
  }

  create(body: Record<string, unknown>): Promise<RoomDetail> {
    return this.api.request('/rooms', { method: 'POST', body });
  }

  join(body: { code?: string; roomId?: string; role?: string }): Promise<RoomDetail> {
    return this.api.request('/rooms/join', { method: 'POST', body });
  }

  detail(id: string): Promise<RoomDetail> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  leave(id: string): Promise<{ ok: boolean }> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/leave`, { method: 'POST', body: {} });
  }

  start(id: string): Promise<RoomDetail> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/start`, { method: 'POST', body: {} });
  }

  pause(id: string): Promise<RoomDetail> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/pause`, { method: 'POST', body: {} });
  }

  end(id: string): Promise<RoomDetail> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/end`, { method: 'POST', body: {} });
  }

  advanceClock(id: string): Promise<RoomDetail> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/clock/advance`, { method: 'POST', body: {} });
  }

  state(id: string, sinceSeq = 0): Promise<Record<string, unknown>> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/state?sinceSeq=${sinceSeq}`, { method: 'GET' });
  }

  portfolio(id: string): Promise<Record<string, unknown>> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/portfolio`, { method: 'GET' });
  }

  credit(id: string): Promise<Record<string, unknown>> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/credit`, { method: 'GET' });
  }

  requestCredit(id: string, amount: number, idempotencyKey: string): Promise<RoomDetail> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/credit/request`, {
      method: 'POST',
      body: { amount, idempotencyKey },
    });
  }

  repayCredit(id: string, amount: number, idempotencyKey: string): Promise<RoomDetail> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/credit/repay`, {
      method: 'POST',
      body: { amount, idempotencyKey },
    });
  }

  convertPoints(id: string, points: number, idempotencyKey: string): Promise<RoomDetail> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/points/convert`, {
      method: 'POST',
      body: { points, idempotencyKey },
    });
  }

  claimReward(id: string, sourceKind: string, sourceRef: string): Promise<RoomDetail> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/rewards/claim`, {
      method: 'POST',
      body: { sourceKind, sourceRef },
    });
  }

  messages(id: string): Promise<{ messages: { id: string; senderName: string; body: string; at: string; status: string }[] }> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/messages`, { method: 'GET' });
  }

  postMessage(id: string, body: string): Promise<Record<string, unknown>> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body } });
  }

  previewOrder(id: string, terms: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/orders/preview`, { method: 'POST', body: terms });
  }

  submitOrder(id: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.api.request(`/rooms/${encodeURIComponent(id)}/orders`, { method: 'POST', body });
  }
}
