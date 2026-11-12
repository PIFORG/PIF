/**
 * HTTP header policy of the Angular production host. It reproduces apps/web/next.config.ts and adds explicit
 * caching rules, so the policy is identical whether the app is served by server/host.mjs or by a reverse proxy
 * configured from this file (see README.md).
 */

/** Pages that receive single-use tokens in the URL: never leak them via Referer, never store the response. */
export const TOKEN_PAGES = ['/verify-email', '/reset-password', '/confirm-email-change'];

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export const TOKEN_PAGE_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

/** Files emitted by `ng build` with a content hash in the name (outputHashing: "all"). */
const HASHED_ASSET = /-[A-Z0-9]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif|ico)$/;

export function isTokenPage(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return TOKEN_PAGES.includes(path);
}

/**
 * Headers for a response to `pathname`.
 * kind: 'document' (index.html for a client route), 'asset' (a file from the build), 'redirect' or 'error'.
 */
export function headersFor(pathname, kind) {
  const headers = { ...SECURITY_HEADERS };
  if (kind === 'asset') {
    headers['Cache-Control'] = HASHED_ASSET.test(pathname) ? 'public, max-age=31536000, immutable' : 'no-cache';
  } else if (kind === 'document') {
    headers['Cache-Control'] = 'no-cache';
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  if (isTokenPage(pathname)) Object.assign(headers, TOKEN_PAGE_HEADERS);
  return headers;
}

/** The request path for logs: never the query string, which may carry a token. */
export function loggablePath(url) {
  const index = url.indexOf('?');
  return index === -1 ? url : `${url.slice(0, index)}?<redacted>`;
}
