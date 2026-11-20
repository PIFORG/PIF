import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EchoAnswer, EchoEvidence } from '../core/echo/echo-api';
import { moduleOf } from '../core/echo/echo-context.service';
import { EchoVoiceService } from '../core/echo/echo-voice.service';
import { StoryNarrationService } from '../stories/story-narration.service';
import { EchoAnswerComponent } from './echo-answer.component';
import { evidenceValue } from './echo-format';

function ev(partial: Partial<EchoEvidence>): EchoEvidence {
  return { kind: 'CALCULATED', kindLabel: 'Calcul', label: 'x', value: null, unit: null, source: null, ...partial };
}

function answer(partial: Partial<EchoAnswer> = {}): EchoAnswer {
  return {
    intent: 'PORTFOLIO_PERFORMANCE',
    status: 'COMPLETE',
    answer: 'Réponse.',
    speech: null,
    context: {},
    evidence: [],
    dataAsOf: null,
    riskFlags: [],
    suggestedActions: [],
    visualization: null,
    scenario: null,
    clarification: null,
    limitations: [],
    sources: [],
    toolsUsed: [],
    engine: 'echo-deterministic-v1',
    ...partial,
  };
}

describe('ÉCHO context', () => {
  it('maps workspace paths to modules', () => {
    expect(moduleOf('/trading')).toBe('TRADING');
    expect(moduleOf('/learn/sessions/abc')).toBe('MISSION');
    expect(moduleOf('/learn')).toBe('MARKETQUEST');
    expect(moduleOf('/actuarial/pricing')).toBe('ACTUARIAL');
    expect(moduleOf('/unknown')).toBe('WORKSPACE');
  });
});

describe('ÉCHO evidence formatting', () => {
  it('formats ratios, currencies, before/after pairs and missing values without inventing data', () => {
    expect(evidenceValue(ev({ value: 0.123, unit: 'ratio' }))).toBe('12,3 %');
    expect(evidenceValue(ev({ value: 1234.5, unit: 'TND' }))).toMatch(/^1\s?234,50 TND$/);
    expect(evidenceValue(ev({ value: { before: 0.1, after: 0.4 }, unit: 'ratio' }))).toBe('10 % → 40 %');
    expect(evidenceValue(ev({ value: null }))).toBe('Indisponible');
    expect(evidenceValue(ev({ value: Number.NaN }))).toBe('Indisponible');
  });
});

describe('EchoAnswerComponent', () => {
  it('shows kind badges, risk flags and a hypothetical scenario table', async () => {
    const fixture = TestBed.createComponent(EchoAnswerComponent);
    fixture.componentRef.setInput(
      'answer',
      answer({
        evidence: [ev({ kind: 'SIMULATION', kindLabel: 'Simulation', label: 'Impact simulé', value: -100, unit: 'TND' })],
        riskFlags: [{ code: 'CONCENTRATION_UP', severity: 'WARNING', message: 'Concentration en hausse.', basis: null }],
        scenario: {
          kind: 'SIMULATION',
          hypothetical: true,
          label: 'Avant / après',
          rows: [
            { label: 'Avant', largestWeight: 0.2 },
            { label: 'Après', largestWeight: 0.45 },
          ],
        },
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.ec-kind')?.textContent).toContain('Simulation');
    expect(root.querySelector('.ec-flags li')?.getAttribute('data-severity')).toBe('WARNING');
    expect(root.querySelector('.ec-tag')?.textContent).toContain('Hypothétique');
    expect(root.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('never draws a chart from fewer than two points', () => {
    const fixture = TestBed.createComponent(EchoAnswerComponent);
    fixture.componentRef.setInput(
      'answer',
      answer({ visualization: { type: 'line', title: 't', unit: null, points: [{ x: 'a', y: 1 }] } }),
    );
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('svg')).toBeNull();
  });
});

describe('EchoVoiceService', () => {
  let speak: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    speak = vi.fn();
    cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel, pause: vi.fn(), resume: vi.fn(), getVoices: () => [] });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        lang = '';
        rate = 1;
        voice: unknown = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public text: string) {}
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('stays silent until the user enables voice', () => {
    const voice = TestBed.inject(EchoVoiceService);
    expect(voice.say('Bonjour')).toBe(false);
    voice.enabled.set(true);
    expect(voice.say('Bonjour')).toBe(true);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('never talks over a FinStories narration', () => {
    const narration = TestBed.inject(StoryNarrationService);
    vi.spyOn(narration, 'status').mockReturnValue('speaking');
    const voice = TestBed.inject(EchoVoiceService);
    voice.enabled.set(true);
    expect(voice.say('Attention', 'alert')).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });

  it('stop() only cancels speech that ÉCHO owns', () => {
    const voice = TestBed.inject(EchoVoiceService);
    voice.stop();
    expect(cancel).not.toHaveBeenCalled();
    voice.enabled.set(true);
    voice.say('Un');
    voice.stop();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
