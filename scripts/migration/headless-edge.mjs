/**
 * Minimal headless Microsoft Edge driver over the DevTools protocol, shared by the migration browser checks.
 * Each launch uses a throwaway profile directory, so no cookies or storage leak between runs.
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Drives one page target; every tab of a launch shares the profile (cookies, BroadcastChannel). */
async function attach(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let seq = 0;
  const pending = new Map();
  const pageErrors = [];
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    }
    for (const [method, cb] of listeners) if (method === msg.method) cb(msg.params);
  });
  const send = (method, params = {}) =>
    new Promise((ok, reject) => {
      const id = ++seq;
      pending.set(id, { ok, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

  async function waitFor(expression, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression).catch(() => false)) return true;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }
  async function go(url, ready) {
    await send('Page.navigate', { url });
    await waitFor(`document.readyState === 'complete'`);
    if (ready) await waitFor(ready);
  }
  async function viewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await sleep(300);
  }
  /** Sets a form control the way a user edit would, so both React and Angular listeners observe it. */
  async function setValue(selector, value) {
    const ok = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`Field ${selector} not found`);
  }
  async function click(selector) {
    const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`Element ${selector} not found or disabled`);
  }
  async function clickText(text, tag = 'button') {
    const ok = await evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find((x) => x.innerText.trim() === ${JSON.stringify(text)});
      if (!el || el.disabled) return false;
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`${tag} "${text}" not found or disabled`);
  }
  const bodyHas = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  return {
    send,
    evaluate,
    waitFor,
    go,
    viewport,
    setValue,
    click,
    clickText,
    bodyHas,
    pageErrors,
    /** Subscribes to a DevTools event of this tab (e.g. Network.responseReceived). */
    on: (method, cb) => listeners.push([method, cb]),
    clearCookies: () => send('Network.clearBrowserCookies'),
    detach: () => ws.close(),
  };
}

export async function launchEdge({ port, name }) {
  const profile = join(tmpdir(), `pif-${name}-${Date.now()}`);
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--hide-scrollbars', '--window-size=1440,900', 'about:blank']);

  let targets;
  for (let i = 0; i < 60 && !targets; i += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      await sleep(200);
    }
  }
  if (!targets) throw new Error('Edge did not start');
  const main = await attach(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  const tabs = [];

  return {
    ...main,
    /** Opens another tab in the same profile, as a user pressing Ctrl+T would. */
    async openTab() {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
      const tab = await attach(target.webSocketDebuggerUrl);
      /** Closes the tab; background tabs are throttled, so the main tab is brought back to the front. */
      tab.close = async () => {
        tab.detach();
        await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
        await main.send('Page.bringToFront');
      };
      tabs.push(tab);
      return tab;
    },
    get allPageErrors() {
      return [main, ...tabs].flatMap((t) => t.pageErrors);
    },
    close() {
      for (const t of tabs) t.detach();
      main.detach();
      edge.kill();
    },
  };
}
