#!/usr/bin/env node
/**
 * Production host for the Angular build (Node built-ins only, no dependency):
 * - serves dist/web-angular/browser with the header policy of server/headers.mjs;
 * - falls back to index.html for client routes, like the Next.js app router serves every page path;
 * - forwards /api/* to the API on the same origin, which the refresh cookie (Path=/api/auth) and
 *   environment.production.ts (apiUrl: '/api') require;
 * - logs requests without query strings, so e-mail link tokens never reach the access log.
 *
 *   HOST_PORT=4300 API_UPSTREAM=http://localhost:3002 node server/host.mjs
 *
 * Variables: HOST_PORT (default 4300), HOST_BIND (default 127.0.0.1), ANGULAR_DIST (default
 * dist/web-angular/browser), API_UPSTREAM (no /api forwarding when unset), HOST_LOG=off to silence logs.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { headersFor, loggablePath } from './headers.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, process.env.ANGULAR_DIST ?? 'dist/web-angular/browser');
const PORT = Number(process.env.HOST_PORT ?? 4300);
const BIND = process.env.HOST_BIND ?? '127.0.0.1';
const UPSTREAM = process.env.API_UPSTREAM ? new URL(process.env.API_UPSTREAM) : null;
const LOG = process.env.HOST_LOG !== 'off';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Hop-by-hop headers are never forwarded (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`No Angular build at ${DIST}. Run "npm run build" in apps/web first.`);
  process.exit(1);
}

function log(req, status) {
  if (LOG) console.log(`${new Date().toISOString()} ${req.method} ${loggablePath(req.url ?? '/')} ${status}`);
}

function send(req, res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  log(req, status);
}

function serveFile(req, res, file, pathname, kind, status = 200) {
  const headers = { ...headersFor(pathname, kind), 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': statSync(file).size };
  res.writeHead(status, headers);
  if (req.method === 'HEAD') {
    res.end();
  } else {
    createReadStream(file).pipe(res);
  }
  log(req, status);
}

/** A file inside DIST for this path, or null. Refuses anything that escapes DIST. */
function fileFor(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = normalize(join(DIST, decoded));
  if (candidate !== DIST && !candidate.startsWith(DIST + sep)) return null;
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null;
}

function forward(req, res) {
  const target = new URL(req.url, UPSTREAM);
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(name)) headers[name] = value;
  headers.host = UPSTREAM.host;
  headers['x-forwarded-host'] = req.headers.host ?? '';
  headers['x-forwarded-proto'] = 'http';
  const remote = req.socket.remoteAddress ?? '';
  headers['x-forwarded-for'] = req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${remote}` : remote;
  const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers }, (up) => {
    const out = {};
    for (const [name, value] of Object.entries(up.headers)) if (!HOP_BY_HOP.has(name)) out[name] = value;
    res.writeHead(up.statusCode ?? 502, out);
    up.pipe(res);
    log(req, up.statusCode ?? 502);
  });
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy();
    send(req, res, 502, { ...headersFor('/api', 'error'), 'Content-Type': 'application/json; charset=utf-8' },
      JSON.stringify({ statusCode: 502, message: 'The API is not reachable.', errorCode: 'UPSTREAM_UNAVAILABLE' }));
  });
  req.pipe(upstream);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://host.invalid');
  const { pathname } = url;

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    if (UPSTREAM) return forward(req, res);
    return send(req, res, 404, { ...headersFor(pathname, 'error'), 'Content-Type': 'application/json; charset=utf-8' },
      JSON.stringify({ statusCode: 404, message: 'No API is configured on this host.', errorCode: 'RESOURCE_NOT_FOUND' }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(req, res, 405, { ...headersFor(pathname, 'error'), Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
  }
  // One canonical URL per page, as Next.js does: drop the trailing slash, keep the query.
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const location = pathname.replace(/\/+$/, '') + url.search;
    return send(req, res, 308, { ...headersFor(pathname, 'redirect'), Location: location }, '');
  }
  const file = pathname === '/' ? null : fileFor(pathname);
  if (file) return serveFile(req, res, file, pathname, 'asset');
  if (extname(pathname)) {
    return send(req, res, 404, { ...headersFor(pathname, 'error'), 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
  }
  return serveFile(req, res, join(DIST, 'index.html'), pathname, 'document');
});

server.listen(PORT, BIND, () => {
  console.log(`Angular host on http://${BIND}:${PORT} serving ${DIST}${UPSTREAM ? `, /api → ${UPSTREAM.origin}` : ''}`);
});
