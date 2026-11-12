import type { StoryScene } from '../core/api/stories-api';
import { formatClock, reelOf, resumePosition, sceneAt, sceneStart, sparkPath, totalDuration } from './story-timeline';

const scene = (id: string, kind: StoryScene['kind'], durationMs: number): StoryScene => ({ id, kind, durationMs, caption: id, visual: { type: 'rewind' } });
const scenes = [scene('a', 'SETUP', 1000), scene('b', 'DECISION', 2000), scene('c', 'PATH_A', 3000), scene('d', 'REWIND', 1000), scene('e', 'PATH_B', 3000), scene('f', 'LESSON', 2000)];

describe('story timeline', () => {
  it('finds the scene and local time for a position', () => {
    expect(totalDuration(scenes)).toBe(12_000);
    expect(sceneAt(scenes, 0)).toEqual({ index: 0, start: 0, local: 0 });
    expect(sceneAt(scenes, 999).index).toBe(0);
    expect(sceneAt(scenes, 1000)).toEqual({ index: 1, start: 1000, local: 0 });
    expect(sceneAt(scenes, 6500)).toEqual({ index: 3, start: 6000, local: 500 });
    expect(sceneAt(scenes, 12_000)).toEqual({ index: 5, start: 10_000, local: 2000 });
    expect(sceneStart(scenes, 4)).toBe(7000);
  });

  it('maps scenes onto the decision, path A and rewind reels', () => {
    expect(scenes.map((s) => reelOf(s.kind).reel)).toEqual([1, 1, 2, 3, 3, null]);
    expect(reelOf('PATH_A').path).toBe('A');
    expect(reelOf('PATH_B').path).toBe('B');
  });

  it('resumes from the saved position unless the story was finished', () => {
    expect(resumePosition({ positionMs: 4000, completed: false }, 12_000)).toBe(4000);
    expect(resumePosition({ positionMs: 11_500, completed: false }, 12_000)).toBe(0);
    expect(resumePosition({ positionMs: 4000, completed: true }, 12_000)).toBe(0);
    expect(resumePosition({ positionMs: 99_000, completed: false }, 200_000)).toBe(99_000);
  });

  it('formats the clock and draws a bounded sparkline', () => {
    expect(formatClock(65_400)).toBe('1:05');
    const d = sparkPath([1, 3, 2], 100, 50, 0);
    expect(d).toBe('M0.0 50.0 L50.0 0.0 L100.0 25.0');
    expect(sparkPath([5, 5], 100, 50, 0)).toBe('M0.0 50.0 L100.0 50.0');
  });
});
