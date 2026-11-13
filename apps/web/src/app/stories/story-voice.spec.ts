import { frenchVoices, isNaturalVoice, spokenText, voiceLabel, type VoiceLike } from './story-voice';

const voice = (name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({
  name,
  lang,
  voiceURI: name,
  localService: true,
  ...extra,
});

describe('story narration voice', () => {
  it('keeps only French voices, neural France-French ones first', () => {
    const voices = [
      voice('Microsoft David - English (United States)', 'en-US', { default: true }),
      voice('Microsoft Julie - French (France)', 'fr-FR'),
      voice('Microsoft Sylvie Online (Natural) - French (Canada)', 'fr-CA'),
      voice('Microsoft Denise Online (Natural) - French (France)', 'fr-FR'),
      voice('Google français', 'fr-FR'),
    ];
    expect(frenchVoices(voices).map((v) => v.name)).toEqual([
      'Microsoft Denise Online (Natural) - French (France)',
      'Google français',
      'Microsoft Julie - French (France)',
      'Microsoft Sylvie Online (Natural) - French (Canada)',
    ]);
  });

  it('never falls back to an English voice', () => {
    expect(frenchVoices([voice('Samantha', 'en-US'), voice('Daniel', 'en-GB')])).toEqual([]);
  });

  it('labels voices briefly in French', () => {
    expect(voiceLabel(voice('Microsoft Denise Online (Natural) - French (France)', 'fr-FR'))).toBe('Denise · naturelle · France');
    expect(voiceLabel(voice('Microsoft Julie - French (France)', 'fr-FR'))).toBe('Julie · France');
    expect(isNaturalVoice(voice('Microsoft Julie - French (France)', 'fr-FR'))).toBe(false);
  });

  it('rewrites the caption for the ear without changing its meaning', () => {
    expect(spokenText('Que feriez-VOUS ? A ou B ? Choisissez mentalement.')).toBe('Que feriez-vous ? A ou B ? Choisissez mentalement.');
    expect(spokenText('A : vendre maintenant. B : conserver et attendre.')).toBe('Option A : vendre maintenant. Option B : conserver et attendre.');
    expect(spokenText('Si vous avez choisi B : Sarah conserve.')).toBe('Si vous avez choisi l’option B : Sarah conserve.');
    expect(spokenText('TunisTech (−7 % en une journée) vaut 990,47 DT.')).toBe('TunisTech (moins 7 % en une journée) vaut 990,47 dinars.');
    expect(spokenText('Ses 20\u00a0000 dinars, soit −2,15 pp.')).toBe('Ses 20 000 dinars, soit moins 2,15 points de pourcentage.');
    expect(spokenText('Le PIB recule.')).toBe('Le PIB recule.');
  });
});
