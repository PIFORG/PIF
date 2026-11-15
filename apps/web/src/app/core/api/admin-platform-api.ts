import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

@Injectable({ providedIn: 'root' })
export class AdminPlatformApi {
  private readonly api = inject(ApiClient);

  supervision(): Promise<{ title: string; modules: { id: string; label: string; status: string }[]; note: string }> {
    return this.api.request('/admin/platform/supervision', { method: 'GET' });
  }

  markets(): Promise<{ instruments: Record<string, unknown>[]; provider: string; description: string }> {
    return this.api.request('/admin/platform/markets', { method: 'GET' });
  }

  learning(): Promise<{ missions: { slug: string; title: string; level: string; availability: string }[]; stats: Record<string, number> }> {
    return this.api.request('/admin/platform/learning', { method: 'GET' });
  }

  ai(): Promise<Record<string, unknown>> {
    return this.api.request('/admin/platform/ai', { method: 'GET' });
  }

  stress(): Promise<Record<string, unknown>> {
    return this.api.request('/admin/platform/stress', { method: 'GET' });
  }

  news(): Promise<{ items: { title: string; publishedAt: string; symbol: string | null; provenance: string }[]; source: { description: string } }> {
    return this.api.request('/admin/platform/news', { method: 'GET' });
  }

  actuarial(): Promise<{ title: string; modules: { id: string; label: string; status: string }[]; note: string }> {
    return this.api.request('/admin/platform/actuarial', { method: 'GET' });
  }
}