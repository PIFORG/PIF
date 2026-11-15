import { Injectable, signal } from '@angular/core';

export type NarrationStatus = 'idle' | 'loading' | 'ready' | 'speaking' | 'paused' | 'completed' | 'error' | 'unsupported';

/**
 * Single owner of browser speechSynthesis for FinStories.
 * Prevents overlapping utterances and tracks lifecycle without treating
 * `speechSynthesis.speaking` alone as proof of audible output.
 */
@Injectable({ providedIn: 'root' })
export class StoryNarrationService {
  private readonly statusSignal = signal<NarrationStatus>('idle');
  private readonly lastErrorSignal = signal<string | null>(null);
  private seq = 0;
  private resumeWatch: number | null = null;
  private speakTimer: number | null = null;
  private currentText: string | null = null;

  readonly status = this.statusSignal.asReadonly();
  readonly lastError = this.lastErrorSignal.asReadonly();

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /** Call from a user gesture to warm up Chromium's speech engine. */
  unlock(): void {
    if (!this.supported) {
      this.statusSignal.set('unsupported');
      return;
    }
    try {
      const synth = window.speechSynthesis;
      try {
        synth.cancel();
      } catch {
        // ignore
      }
      synth.resume();
      // Silent utterance primes autoplay policies after a click; do not cancel it immediately.
      const warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0;
      warm.rate = 10;
      synth.speak(warm);
      this.statusSignal.set(this.statusSignal() === 'unsupported' ? 'unsupported' : 'ready');
    } catch {
      this.statusSignal.set('error');
      this.lastErrorSignal.set("Impossible d'initialiser la synthese vocale.");
    }
  }

  /**
   * Speak French caption text with the given voice.
   * Returns a token; only the latest speak() call owns the engine.
   */
  speak(text: string, voice: SpeechSynthesisVoice, rate = 0.95): number {
    if (!this.supported) {
      this.statusSignal.set('unsupported');
      return -1;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      this.stop();
      return -1;
    }

    this.clearTimers();
    const synth = window.speechSynthesis;
    const token = ++this.seq;
    this.currentText = trimmed;
    this.lastErrorSignal.set(null);
    this.statusSignal.set('loading');

    try {
      synth.cancel();
    } catch {
      // ignore
    }

    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.voice = voice;
    utterance.lang = voice.lang || 'fr-FR';
    utterance.rate = rate;
    utterance.pitch = 1;

    utterance.onstart = () => {
      if (token !== this.seq) return;
      this.statusSignal.set('speaking');
    };
    utterance.onend = () => {
      if (token !== this.seq) return;
      this.statusSignal.set('completed');
      this.clearTimers();
    };
    utterance.onerror = (ev) => {
      if (token !== this.seq) return;
      const err = (ev as SpeechSynthesisErrorEvent).error;
      if (err === 'interrupted' || err === 'canceled') {
        this.statusSignal.set('idle');
      } else {
        this.statusSignal.set('error');
        this.lastErrorSignal.set(`Narration interrompue (${err || 'erreur'}).`);
      }
      this.clearTimers();
    };
    utterance.onpause = () => {
      if (token !== this.seq) return;
      this.statusSignal.set('paused');
    };
    utterance.onresume = () => {
      if (token !== this.seq) return;
      this.statusSignal.set('speaking');
    };

    this.speakTimer = window.setTimeout(() => {
      if (token !== this.seq) return;
      try {
        synth.resume();
      } catch {
        // ignore
      }
      synth.speak(utterance);
      this.resumeWatch = window.setInterval(() => {
        if (token !== this.seq) return;
        try {
          if (synth.paused) {
            synth.resume();
            if (this.statusSignal() === 'loading') this.statusSignal.set('speaking');
          } else if (synth.speaking && this.statusSignal() === 'loading') {
            this.statusSignal.set('speaking');
          }
        } catch {
          // ignore
        }
      }, 1200);
    }, 50);

    return token;
  }

  /** True while this service still considers the scene blocked on narration. */
  isHoldingScene(token: number): boolean {
    if (token !== this.seq) return false;
    const s = this.statusSignal();
    return s === 'loading' || s === 'speaking' || s === 'paused';
  }

  pause(): void {
    if (!this.supported) return;
    try {
      window.speechSynthesis.pause();
      if (this.statusSignal() === 'speaking') this.statusSignal.set('paused');
    } catch {
      // ignore
    }
  }

  resume(): void {
    if (!this.supported) return;
    try {
      window.speechSynthesis.resume();
      if (this.statusSignal() === 'paused') this.statusSignal.set('speaking');
    } catch {
      // ignore
    }
  }

  stop(): void {
    this.seq += 1;
    this.currentText = null;
    this.clearTimers();
    if (this.supported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    const s = this.statusSignal();
    if (s !== 'unsupported') this.statusSignal.set('idle');
  }

  private clearTimers(): void {
    if (this.speakTimer !== null) {
      window.clearTimeout(this.speakTimer);
      this.speakTimer = null;
    }
    if (this.resumeWatch !== null) {
      window.clearInterval(this.resumeWatch);
      this.resumeWatch = null;
    }
  }
}