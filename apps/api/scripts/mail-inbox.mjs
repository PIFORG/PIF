#!/usr/bin/env node
/**
 * Local preview inbox for MAIL_TRANSPORT=preview.
 *
 *   npm run mail:inbox            (from the repository root)
 *
 * Lists the .eml messages captured in MAIL_PREVIEW_DIR (default apps/api/.mail-preview) at
 * http://127.0.0.1:3025. Development only: refuses to start when NODE_ENV=production, binds
 * to the loopback interface, rejects non-loopback peers and foreign Host headers (DNS
 * rebinding), and renders message HTML inside a sandboxed frame with no scripts.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

function readDotEnvKeys(keys) {
  const file = path.resolve(process.cwd(), '.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && keys.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const fileEnv = readDotEnvKeys(['NODE_ENV', 'MAIL_PREVIEW_DIR', 'MAIL_INBOX_PORT']);
const env = (key, fallback) => process.env[key] || fileEnv[key] || fallback;

if (env('NODE_ENV', 'development') === 'production') {
  console.error('The preview inbox is development-only and will not start when NODE_ENV=production.');
  process.exit(1);
}

const HOST = '127.0.0.1';
const PORT = Number.parseInt(env('MAIL_INBOX_PORT', '3025'), 10);
const DIR = path.resolve(process.cwd(), env('MAIL_PREVIEW_DIR', '.mail-preview'));
const ID = /^[0-9]{8}T[0-9]{9}Z-[a-z0-9-]{1,60}-[0-9a-f]{8}$/;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

async function listMessages() {
  if (!existsSync(DIR)) return [];
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json'));
  const metas = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    if (!ID.test(id)) continue;
    try {
      metas.push(JSON.parse(await readFile(path.join(DIR, f), 'utf8')));
    } catch {
      /* partially written file; skip until complete */
    }
  }
  return metas.sort((a, b) => (a.id < b.id ? 1 : -1));
}

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'";
const MAIL_CSP =
  "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'self'";

const STYLE = `
body{margin:0;background:#081322;color:#B8C8DA;font:14px/1.5 Arial,Helvetica,sans-serif}
header{padding:16px 24px;border-bottom:1px solid #1B2B40;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
h1{margin:0;font-size:18px;color:#F4F8FF}
.tag{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#F5B544;border:1px solid #5a4520;border-radius:4px;padding:2px 6px}
main{padding:16px 24px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #1B2B40;vertical-align:top}
th{color:#8A9BB0;font-weight:normal;font-size:12px;text-transform:uppercase;letter-spacing:1px}
a{color:#38BDF8}
.meta{color:#8A9BB0;font-size:12px}
.tabs a{margin-right:16px}
iframe{width:100%;height:calc(100vh - 170px);border:1px solid #1B2B40;border-radius:8px;background:#081322}
pre{white-space:pre-wrap;word-break:break-all;background:#0B1422;border:1px solid #1B2B40;border-radius:8px;padding:16px}
`;

function layout(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title><style>${STYLE}</style></head><body>
<header><h1>MTRS preview inbox</h1><span class="tag">Local preview — not delivered</span><span class="meta">${esc(DIR)}</span></header>
<main>${body}</main></body></html>`;
}

async function handle(req, res) {
  const peer = req.socket.remoteAddress ?? '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) || !ALLOWED_HOSTS.has(req.headers.host ?? '')) {
    return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
  }
  if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (url.pathname === '/') {
    const items = await listMessages();
    const rows = items
      .map(
        (m) => `<tr><td><a href="/m/${esc(m.id)}">${esc(m.subject)}</a><div class="meta">${esc(m.template)}</div></td><td>${esc(m.to)}</td><td class="meta">${esc(m.createdAt)}</td></tr>`,
      )
      .join('');
    const body = items.length
      ? `<p class="meta">${items.length} message(s), newest first. <a href="/">Refresh</a></p><table><thead><tr><th>Subject</th><th>To</th><th>Captured</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p>No captured messages yet. Trigger an email flow (for example, register) with MAIL_TRANSPORT=preview.</p>';
    return send(res, 200, 'text/html; charset=utf-8', layout('MTRS preview inbox', body), {
      'Content-Security-Policy': PAGE_CSP,
    });
  }

  const m = /^\/m\/([^/]+)(?:\/(html|text|eml))?$/.exec(url.pathname);
  if (!m || !ID.test(m[1])) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  const [, id, part] = m;
  const base = path.join(DIR, id);
  if (!existsSync(`${base}.json`)) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');

  if (part === 'html') {
    const html = await readFile(`${base}.html`, 'utf8');
    const withBase = html.replace(/<head>/i, '<head><base target="_blank"/>');
    return send(res, 200, 'text/html; charset=utf-8', withBase, {
      'Content-Security-Policy': MAIL_CSP,
      'X-Frame-Options': 'SAMEORIGIN',
    });
  }
  if (part === 'text') {
    return send(res, 200, 'text/plain; charset=utf-8', await readFile(`${base}.txt`, 'utf8'));
  }
  if (part === 'eml') {
    return send(res, 200, 'message/rfc822', await readFile(`${base}.eml`), {
      'Content-Disposition': `attachment; filename="${id}.eml"`,
    });
  }

  const meta = JSON.parse(await readFile(`${base}.json`, 'utf8'));
  const view = url.searchParams.get('view') === 'text' ? 'text' : 'html';
  const content =
    view === 'text'
      ? `<pre>${esc(await readFile(`${base}.txt`, 'utf8'))}</pre>`
      : `<iframe title="Email HTML rendering" src="/m/${esc(id)}/html"></iframe>`;
  const body = `<p><a href="/">&larr; All messages</a></p>
<h2 style="color:#F4F8FF;font-size:18px;margin:8px 0">${esc(meta.subject)}</h2>
<p class="meta">To ${esc(meta.to)} · ${esc(meta.template)} · captured ${esc(meta.createdAt)}</p>
<p class="tabs"><a href="/m/${esc(id)}">HTML</a><a href="/m/${esc(id)}?view=text">Plain text</a><a href="/m/${esc(id)}/eml">Download .eml</a></p>
${content}`;
  return send(res, 200, 'text/html; charset=utf-8', layout(meta.subject, body), {
    'Content-Security-Policy': PAGE_CSP,
  });
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('Preview inbox error:', err instanceof Error ? err.message : err);
    send(res, 500, 'text/plain; charset=utf-8', 'Internal error');
  });
}).listen(PORT, HOST, () => {
  console.log(`MTRS preview inbox (development only): http://${HOST}:${PORT}`);
  console.log(`Reading captured messages from ${DIR}`);
});
