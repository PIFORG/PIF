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

  it('labels narration as unavailable when the device has no French voice', async () => {
    const { root } = await renderPlayer();
    const narration = buttonNamed(root, /La narration n'est pas disponible : aucune voix française/);
    expect(narration.disabled).toBe(true);
  });

  it('narrates with the chosen French voice and the caption rewritten for the ear', async () => {
    const spoken: { text: string; lang: string; voice: unknown; rate: number }[] = [];
    const synth = { speak: vi.fn((u: { text: string; lang: string; voice: unknown; rate: number }) => spoken.push(u)), cancel: vi.fn() };
    class Utterance {
      lang = '';
      voice: unknown = null;
      rate = 1;
      pitch = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    try {
      const { fixture, root } = await renderPlayer();
      const julie = { name: 'Microsoft Julie - French (France)', lang: 'fr-FR', voiceURI: 'julie', localService: true, default: false };
      fixture.componentRef.setInput('voice', julie);
      fixture.componentRef.setInput('speechAvailable', true);
      fixture.componentRef.setInput('muted', false);
      await settle(fixture);
      buttonNamed(root, 'Lecture').click();
      await settle(fixture);
      expect(synth.speak).toHaveBeenCalled();
      const last = spoken.at(-1);
      expect(last?.lang).toBe('fr-FR');
      expect(last?.voice).toBe(julie);
      expect(last?.rate).toBeLessThan(1);
      expect(last?.text).toBe('What would you do? A or B?'); // emphasis capitals are not spelled out
      expect(buttonNamed(root, 'Couper la narration').getAttribute('title')).toBe('Narration en français · voix Julie · France');
    } finally {
      vi.unstubAllGlobals();
    }
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

  describe('in full-screen story mode', () => {
    const pointer = (type: string, x: number, y: number) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });

    async function renderImmersive() {
      const rendered = await renderPlayer();
      rendered.fixture.componentRef.setInput('immersive', true);
      rendered.fixture.detectChanges();
      const zones = rendered.root.querySelector<HTMLElement>('.st-tapZones');
      if (!zones) throw new Error('No tap zones');
      zones.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 500, right: 300, bottom: 500, x: 0, y: 0, toJSON: () => ({}) });
      return { ...rendered, zones };
    }

    it('taps right for the next scene and left for the previous one', async () => {
      const { fixture, root, zones } = await renderImmersive();
      expect(root.getAttribute('data-immersive')).toBe('true');
      zones.dispatchEvent(pointer('pointerdown', 250, 200));
      zones.dispatchEvent(pointer('pointerup', 250, 200));
      fixture.detectChanges();
      expect(root.querySelector('.st-caption')?.textContent).toBe('If you chose A: Sarah sells.');
      zones.dispatchEvent(pointer('pointerdown', 40, 200));
      zones.dispatchEvent(pointer('pointerup', 40, 200));
      fixture.detectChanges();
      expect(root.querySelector('.st-caption')?.textContent).toBe('What would YOU do? A or B?');
    });

    it('pauses while held and hides the story chrome', async () => {
      const { fixture, root, zones } = await renderImmersive();
      buttonNamed(root, 'Lecture').click();
      fixture.detectChanges();
      zones.dispatchEvent(pointer('pointerdown', 150, 200));
      await new Promise((resolve) => setTimeout(resolve, 260));
      fixture.detectChanges();
      expect(root.getAttribute('data-holding')).toBe('true');
      expect(root.querySelector('.st-holdBadge')?.textContent).toContain('En pause');
      expect(buttonNamed(root, 'Lecture')).toBeTruthy();
      zones.dispatchEvent(pointer('pointerup', 150, 200));
      fixture.detectChanges();
      expect(root.getAttribute('data-holding')).toBeNull();
      expect(buttonNamed(root, 'Pause')).toBeTruthy();
      // Releasing a hold does not also skip a scene.
      expect(root.querySelector('.st-caption')?.textContent).toBe('What would YOU do? A or B?');
    });

    it('turns a vertical swipe into a change of story', async () => {
      const { fixture, root, zones } = await renderImmersive();
      const swipes: string[] = [];
      fixture.componentRef.instance.swipe.subscribe((direction) => swipes.push(direction));
      zones.dispatchEvent(pointer('pointerdown', 150, 400));
      zones.dispatchEvent(pointer('pointerup', 150, 200));
      zones.dispatchEvent(pointer('pointerdown', 150, 100));
      zones.dispatchEvent(pointer('pointerup', 160, 300));
      fixture.detectChanges();
      expect(swipes).toEqual(['up', 'down']);
      expect(root.querySelector('.st-caption')?.textContent).toBe('What would YOU do? A or B?');
    });

    it('has no tap zones outside full-screen mode', async () => {
      const { root } = await renderPlayer();
      expect(root.querySelector('.st-tapZones')).toBeNull();
      expect(root.getAttribute('data-immersive')).toBeNull();
    });
  });
});
