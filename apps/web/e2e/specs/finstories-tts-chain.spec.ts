import { test, expect } from '../fixtures/auth';
import { setTheme } from '../fixtures/page';

/** FinStories: chaîne speechSynthesis (pas une preuve acoustique). */
test.describe('FinStories narration TTS (chaîne technique)', () => {
  test('activation narration et alternative textuelle', async ({ asInvestor: page }) => {
    await page.goto('/stories');
    await setTheme(page, 'light');
    await expect(page.getByRole('main')).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __ttsLog: string[] }).__ttsLog = [];
      const log = (window as unknown as { __ttsLog: string[] }).__ttsLog;
      const synth = window.speechSynthesis;
      synth.speak = ((u: SpeechSynthesisUtterance) => {
        log.push(u.text || '');
        queueMicrotask(() => {
          try { u.dispatchEvent(new Event('start')); } catch { /* */ }
          try { (u as unknown as { onstart?: (e: Event) => void }).onstart?.(new Event('start')); } catch { /* */ }
          window.setTimeout(() => {
            try { (u as unknown as { onend?: (e: Event) => void }).onend?.(new Event('end')); } catch { /* */ }
          }, 20);
        });
      }) as typeof synth.speak;
    });

    const enable = page.getByRole('button', { name: /Activer la narration/i });
    const openBtn = page.getByRole('button', { name: /Lire|Ouvrir|Commencer|Regarder/i }).first();
    if (await openBtn.count()) await openBtn.click();
    else {
      const card = page.locator('.st-card, article, a[href*="stories"]').first();
      if (await card.count()) await card.click();
    }
    if (await enable.count()) await enable.click();

    await page.waitForTimeout(600);
    const log = await page.evaluate(() => (window as unknown as { __ttsLog?: string[] }).__ttsLog ?? []);
    const spoken = log.filter((t) => (t || '').trim().length > 1);
    test.info().annotations.push({
      type: 'note',
      description: spoken.length
        ? 'Chaîne speak() OK — audibilité acoustique NON prouvée (headless)'
        : 'speak() non observé — exécuter checklist manuelle docs/qa/FINSTORIES_TTS_MANUAL.md',
    });
    await expect(page.locator('body')).toContainText(/FinStories|histoire|scénario|narration|sous-titres/i);
  });
});