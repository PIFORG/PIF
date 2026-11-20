import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

@Injectable({ providedIn: 'root' })
export class AdminPlatformApi {
  private readonly api = inject(ApiClient);

  supervision(): Promise<{
    title: string;
    modules: { id: string; label: string; status: string }[];
    note: string;
    stats?: Record<string, unknown>;
    simulation?: Record<string, unknown>;
  }> {
    return this.api.request('/admin/platform/supervision', { method: 'GET' });
  }

  markets(): Promise<{
    instruments: Record<string, unknown>[];
    provider: string;
    description: string;
    writable?: boolean;
  }> {
    return this.api.request('/admin/platform/markets', { method: 'GET' });
  }

  setInstrumentStatus(symbol: string, status: 'ACTIVE' | 'HALTED'): Promise<{ symbol: string; status: string }> {
    return this.api.request(`/admin/platform/markets/${encodeURIComponent(symbol)}/status`, {
      method: 'PATCH',
      body: { status },
    });
  }

  learning(): Promise<{
    missions: { slug: string; title: string; level: string; availability: string; adminDisabled?: boolean }[];
    stats: Record<string, number>;
    progression?: Record<string, unknown>;
  }> {
    return this.api.request('/admin/platform/learning', { method: 'GET' });
  }

  setMissionDisabled(slug: string, disabled: boolean): Promise<{ slug: string; adminDisabled: boolean }> {
    return this.api.request(`/admin/platform/learning/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: { disabled },
    });
  }

  ai(): Promise<Record<string, unknown>> {
    return this.api.request('/admin/platform/ai', { method: 'GET' });
  }

  setAiDisabled(modelId: string, disabled: boolean): Promise<{ modelId: string; adminDisabled: boolean }> {
    return this.api.request(`/admin/platform/ai/${encodeURIComponent(modelId)}`, {
      method: 'PATCH',
      body: { disabled },
    });
  }

  stress(): Promise<Record<string, unknown>> {
    return this.api.request('/admin/platform/stress', { method: 'GET' });
  }

  setStressDisabled(presetId: string, disabled: boolean): Promise<{ presetId: string; adminDisabled: boolean }> {
    return this.api.request(`/admin/platform/stress/${encodeURIComponent(presetId)}`, {
      method: 'PATCH',
      body: { disabled },
    });
  }

  news(): Promise<{
    items: { id?: string; title: string; publishedAt: string; symbol: string | null; provenance: string; adminManaged?: boolean }[];
    source: { description: string };
  }> {
    return this.api.request('/admin/platform/news', { method: 'GET' });
  }

  publishNews(body: { title: string; summary?: string; symbol?: string; sector?: string }): Promise<Record<string, unknown>> {
    return this.api.request('/admin/platform/news', { method: 'POST', body });
  }

  deleteNews(id: string): Promise<{ id: string; deleted: boolean }> {
    return this.api.request(`/admin/platform/news/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  actuarial(): Promise<{ title: string; modules: { id: string; label: string; status: string }[]; note: string }> {
    return this.api.request('/admin/platform/actuarial', { method: 'GET' });
  }

  challenges(): Promise<{ challenges: { id: string; title: string; open?: boolean; startingCapital?: number }[]; note?: string }> {
    return this.api.request('/admin/platform/challenges', { method: 'GET' });
  }

  createChallenge(body: { title: string; description?: string; startingCapital?: number }): Promise<Record<string, unknown>> {
    return this.api.request('/admin/platform/challenges', { method: 'POST', body });
  }

  simulation(): Promise<Record<string, unknown>> {
    return this.api.request('/admin/platform/simulation', { method: 'GET' });
  }

  updateSimulation(body: { newsPaused?: boolean; depthScalePct?: number }): Promise<Record<string, unknown>> {
    return this.api.request('/admin/platform/simulation', { method: 'PATCH', body });
  }
}