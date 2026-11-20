import { Injectable, inject, signal } from '@angular/core';
import { StoryNarrationService } from '../../stories/story-narration.service';

export type VoicePriority = 'alert' | 'answer';
export type ListenState = 'idle' | 'listening' | 'unsupported' | 'denied' | 'error';

interface Queued {
  text: string;
  priority: VoicePriority;
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/**
 * Single owner of ÉCHO's audio. Speech synthesis is opt-in (preferences), queued by priority
 * (alerts first, at most 3 pending), cancelled on navigation, and never overlaps FinStories:
 * while the story narrator holds the engine, ÉCHO stays silent (the text remains on screen).
 * Push-to-talk only: recognition starts on an explicit click, single utterance, never continuous.
 */
@Injectable({ providedIn: 'root' })
export class EchoVoiceService {
  private readonly narration = inject(StoryNarrationService);
  private readonly queue: Queued[] = [];
  private speakingNow = false;
  private recognition: RecognitionLike | null = null;

  readonly speaking = signal(false);
  readonly listen = signal<ListenState>('idle');
  readonly enabled = signal(false);

  get synthesisSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  get recognitionSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as Record<string, unknown>;
    return typeof w['SpeechRecognition'] === 'function' || typeof w['webkitSpeechRecognition'] === 'function';
  }

  private reducedMotion(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  private storyHoldsAudio(): boolean {
    const s = this.narration.status();
    return s === 'loading' || s === 'speaking' || s === 'paused';
  }

  private frenchVoice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => v.lang === 'fr-FR') ?? voices.find((v) => v.lang?.toLowerCase().startsWith('fr')) ?? null;
  }

  /** Speaks only when the user enabled voice. Returns false when the text was not queued. */
  say(text: string | null | undefined, priority: VoicePriority = 'answer'): boolean {
    const clean = (text ?? '').replace(/\s+/g, ' ').trim();
    if (!clean || !this.enabled() || !this.synthesisSupported || this.storyHoldsAudio()) return false;
    if (priority === 'alert') {
      this.queue.unshift({ text: clean.slice(0, 400), priority });
    } else {
      // A new answer replaces older pending answers; alerts stay.
      for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].priority === 'answer') this.queue.splice(i, 1);
      this.queue.push({ text: clean.slice(0, 600), priority });
    }
    this.queue.splice(3);
    if (!this.speakingNow) this.next();
    return true;
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item || this.storyHoldsAudio()) {
      this.speakingNow = false;
      this.speaking.set(false);
      return;
    }
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(item.text);
    const voice = this.frenchVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'fr-FR';
    u.rate = this.reducedMotion() ? 0.9 : 1;
    u.onend = () => this.next();
    u.onerror = () => this.next();
    this.speakingNow = true;
    this.speaking.set(true);
    try {
      synth.speak(u);
    } catch {
      this.next();
    }
  }

  pause(): void {
    if (this.synthesisSupported && this.speakingNow) window.speechSynthesis.pause();
  }

  resume(): void {
    if (this.synthesisSupported && this.speakingNow) window.speechSynthesis.resume();
  }

  /** Stops ÉCHO's own speech (not FinStories'): only cancels when ÉCHO owns the engine. */
  stop(): void {
    this.queue.length = 0;
    if (this.speakingNow && this.synthesisSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.speakingNow = false;
    this.speaking.set(false);
  }

  /** Push-to-talk: one utterance, French, started by a click. Resolves with the transcript or null. */
  listenOnce(): Promise<string | null> {
    if (!this.recognitionSupported) {
      this.listen.set('unsupported');
      return Promise.resolve(null);
    }
    this.stop();
    const w = window as unknown as Record<string, new () => RecognitionLike>;
    const Ctor = w['SpeechRecognition'] ?? w['webkitSpeechRecognition'];
    const rec = new Ctor();
    rec.lang = 'fr-FR';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    this.recognition = rec;
    this.listen.set('listening');
    return new Promise((resolve) => {
      let transcript: string | null = null;
      rec.onresult = (ev) => {
        transcript = ev.results[0]?.[0]?.transcript ?? null;
      };
      rec.onerror = (ev) => {
        this.listen.set(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'denied' : 'error');
      };
      rec.onend = () => {
        this.recognition = null;
        if (this.listen() === 'listening') this.listen.set('idle');
        resolve(transcript);
      };
      try {
        rec.start();
      } catch {
        this.listen.set('error');
        resolve(null);
      }
    });
  }

  stopListening(): void {
    this.recognition?.stop();
  }
}
