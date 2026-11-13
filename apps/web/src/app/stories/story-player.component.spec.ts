import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StoriesApi, type Story } from '../core/api/stories-api';
import { StoryPlayerComponent } from './story-player.component';

const story: Story = {
  slug: 'sarah-and-the-market-crash',
  version: 2,
  title: 'Sarah and the Market Crash',
  character: 'SARAH',
  summary: 'Sell or hold?',
  competency: 'RISK_MANAGEMENT',
  level: 'COMMANDER',
  relatedMissionSlug: 'survive-the-market-crash',
  durationMs: 10_000,
  media: { videoUrl: null, posterUrl: null, format: 'MOTION_GRAPHICS' },
  progress: { positionMs: 2500, completed: false, reflection: null, updatedSinceLastWatch: false, watchedEarlierVersion: false },
  scenes: [
    { id: 's1', kind: 'SETUP', durationMs: 2000, caption: 'Meet Sarah.', visual: { type: 'intro', character: 'SARAH', amount: 10_000 } },
    { id: 's2', kind: 'DECISION', durationMs: 2000, caption: 'What would YOU do? A or B?', visual: { type: 'headline', text: 'Markets slide', sentiment: 'NEGATIVE' } },
    { id: 's3', kind: 'PATH_A', durationMs: 2000, caption: 'If you chose A: Sarah sells.', visual: { type: 'outcome', from: 8500, to: 8457.5, label: 'Sold' } },
    { id: 's4', kind: 'REWIND', durationMs: 2000, caption: "Let's rewind.", visual: { type: 'rewind' } },
    { id: 's5', kind: 'LESSON', durationMs: 2000, caption: 'A decision cannot be judged only by its profit.', visual: { type: 'lesson', points: ['One', 'Two'] } },
  ],
};

describe('StoryPlayer', () => {
  let progress: ReturnType<typeof vi.fn>;

  async function settle<T>(fixture: ComponentFixture<T>) {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  }

  async function renderPlayer() {
    progress = vi.fn(async (slug: string, positionMs: number, completed?: boolean) => ({
      slug,
      positionMs,
      completed: !!completed,
      reflection: null,
      updatedSinceLastWatch: false,
      watchedEarlierVersion: false,
      durationMs: 10_000,
    }));
    TestBed.configureTestingModule({
      imports: [StoryPlayerComponent],
      providers: [provideRouter([]), { provide: StoriesApi, useValue: { story: vi.fn().mockResolvedValue(story), progress } }],
    });
    const fixture = TestBed.createComponent(StoryPlayerComponent);
    const ref = fixture.componentRef;
    ref.setInput('summary', story);
    ref.setInput('active', true);
    ref.setInput('preload', false);
    ref.setInput('muted', true);
    ref.setInput('captions', true);
    ref.setInput('reducedMotion', true);
    ref.setInput('speechAvailable', false);
    await settle(fixture);
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  function buttonNamed(root: HTMLElement, name: string | RegExp): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((b) => {
      const label = b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '';
      return typeof name === 'string' ? label === name : name.test(label);
    });
    if (!found) throw new Error(`No button named ${String(name)}`);
    return found;
  }

  it('resumes at the saved scene and never asks the viewer to press A or B', async () => {
    const { root } = await renderPlayer();
    expect(root.querySelector('.st-caption')?.textContent).toBe('What would YOU do? A or B?');
    expect(Array.from(root.querySelectorAll('.st-reel')).map((r) => r.textContent)).toContain('Épisode 1 · La décision');
    const labels = Array.from(root.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(labels.some((label) => /^(A|B)$|choose/i.test(label.trim()))).toBe(false);
  });

  it('moves between scenes and reels with accessible controls', async () => {
    const { fixture, root } = await renderPlayer();
    buttonNamed(root, 'Scène suivante').click();
    fixture.detectChanges();
    expect(root.querySelector('.st-reel')?.textContent).toBe('Épisode 2 · Si vous choisissiez A');
    expect(root.querySelector('.st-reel')?.getAttribute('data-path')).toBe('A');
    buttonNamed(root, 'Scène suivante').click();
    fixture.detectChanges();
    expect(root.querySelector('.st-reel')?.textContent).toBe('Épisode 3 · Remontons le temps');
    expect(root.querySelector('.st-rewindTitle')?.textContent).toBe('Revenons en arrière !');
    buttonNamed(root, 'Scène précédente').click();
    fixture.detectChanges();
    expect(root.querySelector('.st-caption')?.textContent).toBe('If you chose A: Sarah sells.');
  });

  it('does not autoplay with reduced motion and saves progress when paused', async () => {
    const { fixture, root } = await renderPlayer();
    expect(buttonNamed(root, 'Lecture')).toBeTruthy();
    buttonNamed(root, 'Scène suivante').click();
    buttonNamed(root, 'Lecture').click();
    fixture.detectChanges();
    buttonNamed(root, 'Pause').click();
    expect(progress).toHaveBeenCalledWith('sarah-and-the-market-crash', 4000, undefined);
  });

  it('labels narration as unavailable when the browser has no speech synthesis', async () => {
    const { root } = await renderPlayer();
    const narration = buttonNamed(root, /La narration n'est pas prise en charge/);
    expect(narration.disabled).toBe(true);
  });

  it('answers the keyboard shortcuts on the player region', async () => {
    const { fixture, root } = await renderPlayer();
    expect(root.getAttribute('role')).toBe('region');
    expect(root.getAttribute('aria-roledescription')).toBe("lecteur d'histoire");
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('.st-caption')?.textContent).toBe('If you chose A: Sarah sells.');
    const captions = vi.fn();
    fixture.componentRef.instance.toggleCaptions.subscribe(captions);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(captions).toHaveBeenCalledTimes(1);
  });
});
