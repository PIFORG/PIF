import type { ComponentFixture } from '@angular/core/testing';

/* DOM helpers for the actuarial page specs, mirroring the Testing Library queries of the React tests. */

const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function settle<T>(fixture: ComponentFixture<T>): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await sleep(0);
    await fixture.whenStable();
  }
}

/** Retries an assertion until it passes, like Testing Library's waitFor. */
export async function waitFor<T>(fixture: ComponentFixture<T>, check: () => void, timeout = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - start > timeout) throw error;
    }
    await sleep(20);
    await fixture.whenStable();
  }
}

/** Text of an element's own text nodes, as matched by getByText. */
function ownText(el: Element): string {
  return normalize(
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join(''),
  );
}

function matches(text: string, matcher: string | RegExp): boolean {
  return typeof matcher === 'string' ? text === matcher : matcher.test(text);
}

export function queryText(root: ParentNode, matcher: string | RegExp): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('*')).find((el) => matches(ownText(el), matcher)) ?? null;
}

export function getText(root: ParentNode, matcher: string | RegExp): HTMLElement {
  const el = queryText(root, matcher);
  if (!el) throw new Error(`No element with text ${String(matcher)}`);
  return el;
}

/** The form control labelled by a <label for> whose text matches. */
export function getControl<T extends HTMLElement = HTMLInputElement>(root: HTMLElement, label: string): T {
  const found = Array.from(root.querySelectorAll('label')).find((l) => normalize(l.textContent) === label);
  const id = found?.getAttribute('for');
  const control = id ? root.querySelector<T>(`#${CSS.escape(id)}`) : null;
  if (!control) throw new Error(`No control labelled “${label}”`);
  return control;
}

export function queryButton(root: HTMLElement, name: string | RegExp): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll('button')).find((b) => matches(normalize(b.textContent), name)) ?? null;
}

export function getButton(root: HTMLElement, name: string | RegExp): HTMLButtonElement {
  const button = queryButton(root, name);
  if (!button) throw new Error(`No button named ${String(name)}`);
  return button;
}

export function kpi(root: HTMLElement, label: string): HTMLElement {
  const card = Array.from(root.querySelectorAll<HTMLElement>('.ws-kpi')).find((k) => normalize(k.querySelector('.ws-kpiLabel')?.textContent) === label);
  if (!card) throw new Error(`No KPI “${label}”`);
  return card;
}

export function tableByCaption(root: HTMLElement, caption: RegExp): HTMLTableElement {
  const table = Array.from(root.querySelectorAll('table')).find((t) => caption.test(normalize(t.querySelector('caption')?.textContent)));
  if (!table) throw new Error(`No table captioned ${String(caption)}`);
  return table;
}

/** Types into an input or textarea, or picks a select option, and fires the event the template listens to. */
export function change(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}
