import type { StoryScene } from '../core/api/stories-api';

/** apps/web/src/components/learning/stories/storyTimeline.ts */

export interface ScenePosition {
  index: number;
  start: number;
  /** Milliseconds elapsed inside the current scene. */
  local: number;
}

export function totalDuration(scenes: StoryScene[]): number {
  return scenes.reduce((s, scene) => s + scene.durationMs, 0);
}

/** Scene playing at `positionMs`; the end of the story maps to the last frame of the last scene. */
export function sceneAt(scenes: StoryScene[], positionMs: number): ScenePosition {
  let start = 0;
  for (let i = 0; i < scenes.length; i++) {
    const end = start + scenes[i].durationMs;
    if (positionMs < end || i === scenes.length - 1) {
      return { index: i, start, local: Math.min(Math.max(0, positionMs - start), scenes[i].durationMs) };
    }
    start = end;
  }
  return { index: 0, start: 0, local: 0 };
}

/**
 * Next playback position while the narrator is still speaking: playback may move within the current scene but stops
 * on its last frame instead of entering the next one, so a sentence is never cut. Never moves backwards.
 */
export function holdForSpeech(scenes: StoryScene[], positionMs: number, nextMs: number): number {
  if (scenes.length === 0) return nextMs;
  const at = sceneAt(scenes, positionMs);
  const lastFrame = at.start + scenes[at.index].durationMs - 1;
  return Math.max(positionMs, Math.min(nextMs, lastFrame));
}

export function sceneStart(scenes: StoryScene[], index: number): number {
  return scenes.slice(0, Math.max(0, index)).reduce((s, scene) => s + scene.durationMs, 0);
}

export interface ReelInfo {
  reel: 1 | 2 | 3 | null;
  label: string;
  path: 'A' | 'B' | null;
}

/** Maps scene kinds to the three-reel structure: the decision, path A, then the rewind into path B. */
export function reelOf(kind: StoryScene['kind']): ReelInfo {
  switch (kind) {
    case 'SETUP':
    case 'DECISION':
      return { reel: 1, label: 'Épisode 1 · La décision', path: null };
    case 'PATH_A':
      return { reel: 2, label: 'Épisode 2 · Si vous choisissiez A', path: 'A' };
    case 'REWIND':
      return { reel: 3, label: 'Épisode 3 · Remontons le temps', path: null };
    case 'PATH_B':
      return { reel: 3, label: 'Épisode 3 · Si vous choisissiez B', path: 'B' };
    case 'LESSON':
      return { reel: null, label: 'La leçon', path: null };
  }
}

/** Where playback starts: saved position, unless the story was finished or almost finished. */
export function resumePosition(progress: { positionMs: number; completed: boolean }, durationMs: number): number {
  if (progress.completed || progress.positionMs >= durationMs * 0.95) return 0;
  return Math.max(0, Math.min(progress.positionMs, durationMs));
}

export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** SVG path for a small sparkline in a `width` × `height` box. */
export function sparkPath(values: number[], width: number, height: number, pad = 6): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(pad + i * step).toFixed(1)} ${(pad + (1 - (v - min) / span) * (height - pad * 2)).toFixed(1)}`)
    .join(' ');
}
