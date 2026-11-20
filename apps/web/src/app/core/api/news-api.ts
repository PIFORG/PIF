import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';

export interface NewsFeed {
  items: {
    id: string;
    title: string;
    summary: string;
    symbol: string | null;
    sector: string;
    publishedAt: string;
    provenance: string;
    sourceId?: string;
    originalUrl?: string | null;
    market?: string | null;
    verification?: string;
  }[];
  source?: { id: string; kind: string; description: string };
  availability?: string;
  realNewsCount?: number;
  adminPublishedCount?: number;
  limitations: string[];
}

@Injectable({ providedIn: 'root' })
export class NewsApi {
  private readonly api = inject(ApiClient);
  feed(): Promise<NewsFeed> {
    return this.api.request('/market/news', { method: 'GET' });
  }
}