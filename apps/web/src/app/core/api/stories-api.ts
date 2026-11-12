import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';
import type { Competency, StoryCharacter, StoryProgress, StorySummary } from './learning-api';

/**
 * FinStories endpoints of apps/web/src/lib/api/learning.ts (contract: apps/api/src/learning/stories). The summary and
 * progress types are shared with the MarketQuest hub and live in learning-api.ts.
 */

export type { Competency, StoryCharacter, StoryProgress, StorySummary } from './learning-api';

export type StoryVisual =
  | { type: 'intro'; character: StoryCharacter; amount: number }
  | { type: 'headline'; text: string; sentiment: 'NEGATIVE' | 'POSITIVE' | 'NEUTRAL' }
  | { type: 'allocation'; slices: { label: string; pct: number }[] }
  | { type: 'chart'; series: number[]; tone: 'up' | 'down' | 'flat'; label?: string }
  | { type: 'outcome'; from: number; to: number; label: string }
  | { type: 'rewind' }
  | { type: 'lesson'; points: string[] };

export interface StoryScene {
  id: string;
  kind: 'SETUP' | 'DECISION' | 'PATH_A' | 'REWIND' | 'PATH_B' | 'LESSON';
  durationMs: number;
  caption: string;
  visual: StoryVisual;
}

export interface Story extends StorySummary {
  scenes: StoryScene[];
}

export interface StoryFeed {
  weakestCompetency: Competency | null;
  stories: StorySummary[];
}

export type SavedStoryProgress = StoryProgress & { slug: string; durationMs: number };

@Injectable({ providedIn: 'root' })
export class StoriesApi {
  private readonly api = inject(ApiClient);

  feed(): Promise<StoryFeed> {
    return this.api.request('/learning/stories', { method: 'GET' });
  }

  story(slug: string): Promise<Story> {
    return this.api.request(`/learning/stories/${encodeURIComponent(slug)}`, { method: 'GET' });
  }

  progress(slug: string, positionMs: number, completed?: boolean): Promise<SavedStoryProgress> {
    return this.api.request(`/learning/stories/${encodeURIComponent(slug)}/progress`, {
      method: 'PUT',
      body: completed === undefined ? { positionMs: Math.round(positionMs) } : { positionMs: Math.round(positionMs), completed },
    });
  }
}
