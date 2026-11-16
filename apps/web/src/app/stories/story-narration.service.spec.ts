import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryNarrationService } from './story-narration.service';

describe('StoryNarrationService', () => {
  let service: StoryNarrationService;
  let spoken: SpeechSynthesisUtterance[];
  let synth: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    speaking: boolean;
    paused: boolean;
  };

  class Utterance {
    lang = '';
    voice: SpeechSynthesisVoice | null = null;
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart: ((ev: SpeechSynthesisEvent) => void) | null = null;
    onend: ((ev: SpeechSynthesisEvent) => void) | null = null;
    onerror: ((ev: SpeechSynthesisEvent) => void) | null = null;
    onpause: ((ev: SpeechSynthesisEvent) => void) | null = null;
    onresume: ((ev: SpeechSynthesisEvent) => void) | null = null;
    constructor(public text: string) {}
  }

  const julie = {
    name: 'Microsoft Julie - French (France)',
    lang: 'fr-FR',
    voiceURI: 'julie',
    localService: true,
    default: false,
  } as SpeechSynthesisVoice;

  beforeEach(() => {
    spoken = [];
    synth = {
      speak: vi.fn((u: SpeechSynthesisUtterance) => {
        spoken.push(u);
        synth.speaking = true;
        synth.paused = false;
        void Promise.resolve().then(() => u.onstart?.(new Event('start') as SpeechSynthesisEvent));
      }),
      cancel: vi.fn(() => {
        synth.speaking = false;
        synth.paused = false;
      }),
      resume: vi.fn(() => {
        synth.paused = false;
      }),
      pause: vi.fn(() => {
        synth.paused = true;
      }),
      speaking: false,
      paused: false,
    };
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    service = new StoryNarrationService();
  });

  afterEach(() => {
    service?.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('unlock sets ready after a user gesture warm-up', () => {
    service.unlock();
    expect(synth.resume).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalled();
    expect(service.status()).toBe('ready');
  });

  it('speak transitions loading → speaking → completed', async () => {
    vi.useFakeTimers();
    const token = service.speak('Bonjour le marché', julie, 0.95);
    expect(token).toBeGreaterThan(0);
    expect(service.status()).toBe('loading');
    expect(service.isHoldingScene(token)).toBe(true);

    await vi.advanceTimersByTimeAsync(50);
    expect(synth.speak).toHaveBeenCalled();
    const u = spoken.at(-1)!;
    expect(u.text).toBe('Bonjour le marché');
    expect(u.lang).toBe('fr-FR');
    expect(u.voice).toBe(julie);
    expect(u.rate).toBeLessThan(1);

    await Promise.resolve();
    expect(service.status()).toBe('speaking');

    u.onend?.(new Event('end') as SpeechSynthesisEvent);
    expect(service.status()).toBe('completed');
    expect(service.isHoldingScene(token)).toBe(false);
  });

  it('stop invalidates the previous token and cancels synthesis', async () => {
    vi.useFakeTimers();
    const token = service.speak('Phrase une', julie);
    await vi.advanceTimersByTimeAsync(50);
    service.stop();
    expect(synth.cancel).toHaveBeenCalled();
    expect(service.status()).toBe('idle');
    expect(service.isHoldingScene(token)).toBe(false);
  });

  it('a newer speak supersedes the previous token', async () => {
    vi.useFakeTimers();
    const first = service.speak('Première', julie);
    await vi.advanceTimersByTimeAsync(50);
    const second = service.speak('Deuxième', julie);
    expect(service.isHoldingScene(first)).toBe(false);
    expect(service.isHoldingScene(second)).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(spoken.at(-1)?.text).toBe('Deuxième');
  });

  it('pause and resume update status without dropping the token', async () => {
    vi.useFakeTimers();
    const token = service.speak('Pause test', julie);
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    service.pause();
    expect(synth.pause).toHaveBeenCalled();
    expect(service.status()).toBe('paused');
    expect(service.isHoldingScene(token)).toBe(true);
    service.resume();
    expect(synth.resume).toHaveBeenCalled();
    expect(service.status()).toBe('speaking');
  });

  it('empty text does not speak', () => {
    const token = service.speak('   ', julie);
    expect(token).toBe(-1);
    expect(synth.speak).not.toHaveBeenCalled();
  });
});