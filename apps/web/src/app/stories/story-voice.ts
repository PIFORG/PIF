/**
 * French narration for FinStories with the browser's speech synthesis. Only French voices are ever used: reading the
 * French script with an English voice gives an English accent. The best voice is chosen automatically — neural
 * ("Natural", "Online", "Neural") voices first, then Google's, then the system voices — and France's French (fr-FR)
 * before the Canadian, Belgian or Swiss variants.
 */

export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default?: boolean;
}

export const VOICE_STORAGE_KEY = 'mtrs-story-voice';

/** True for voices whose name marks a neural, human-sounding engine. */
export function isNaturalVoice(v: VoiceLike): boolean {
  return /natural|naturel|neural|online|premium|enhanced|améliorée/i.test(v.name);
}

function score(v: VoiceLike): number {
  const lang = v.lang.replace('_', '-').toLowerCase();
  let s = lang === 'fr-fr' ? 20 : 10;
  if (isNaturalVoice(v)) s += 8;
  if (/google/i.test(v.name)) s += 4;
  if (v.default) s += 1;
  return s;
}

/** The French voices, best first. Never returns a non-French voice. */
export function frenchVoices<T extends VoiceLike>(voices: readonly T[]): T[] {
  return voices
    .filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('fr'))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, 'fr'));
}

const REGION: Record<string, string> = { 'fr-fr': 'France', 'fr-ca': 'Canada', 'fr-be': 'Belgique', 'fr-ch': 'Suisse' };

/** "Microsoft Denise Online (Natural) - French (France)" → "Denise · naturelle · France". */
export function voiceLabel(v: VoiceLike): string {
  const base = v.name
    .replace(/^(Microsoft|Google|Apple)\s+/i, '')
    .replace(/\s*-\s*French.*$/i, '')
    .replace(/\s*\((natural|naturel)\)/i, '')
    .replace(/\s+online\b/i, '')
    .trim();
  const region = REGION[v.lang.replace('_', '-').toLowerCase()];
  return [base || v.name, isNaturalVoice(v) ? 'naturelle' : null, region].filter(Boolean).join(' · ');
}

/** Acronyms read letter by letter on purpose; every other all-capital word is emphasis and is read as a word. */
const ACRONYMS = new Set(['PIB', 'TND', 'BCT', 'ETF', 'CET1', 'LCR', 'PSIA', 'IRR', 'PER', 'VAR']);

/**
 * The caption rewritten for the ear, never for the eye: the subtitles keep the original text. Emphasis capitals are
 * lowered ("VOUS" would be spelled out), units are spelled out, the minus sign is read, and the bare choice letters
 * become "option A" so that "A :" is not heard as the verb "a".
 */
export function spokenText(caption: string): string {
  return caption
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/−\s?/g, 'moins ')
    .replace(/\bDT\b/g, 'dinars')
    .replace(/\bpp\b/g, 'points de pourcentage')
    .replace(/(^|[.!?]\s+)([AB])\s*:/g, (_m, lead: string, letter: string) => `${lead}Option ${letter} :`)
    .replace(/\bchoisi ([AB])\b/g, 'choisi l’option $1')
    .replace(/\b[A-ZÀ-ÖØ-Þ]{3,}\b/g, (word) => (ACRONYMS.has(word) ? word : word.toLowerCase()))
    .replace(/\s+/g, ' ')
    .trim();
}
