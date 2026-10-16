import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function rejected(message = 'Request origin could not be verified') {
  return new ForbiddenException({ message, errorCode: 'CSRF_REJECTED' });
}

/**
 * Origin verification for the cookie-bearing auth endpoints, in this order:
 *   1. Origin header present  -> must be an allowlisted origin (no exceptions, "null" included).
 *   2. Sec-Fetch-Site         -> "same-origin"/"none" pass, "cross-site" fails; "same-site" is
 *                                NOT trusted on its own (a sibling subdomain is another site).
 *   3. Referer                -> its origin must be allowlisted.
 *   4. No signal at all       -> allowed outside production only (CLI tools, tests).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

    // A Bearer header cannot be attached cross-site without a CORS preflight, so requests
    // that carry no refresh cookie and do not target cookie routes are not CSRF targets.
    const path = req.path || '';
    const cookieName = this.config.get<string>('cookie.name') ?? 'mtrs_refresh';
    const hasRefreshCookie = Boolean(req.cookies?.[cookieName]);
    const cookieRoute = path.includes('/auth/refresh') || path.includes('/auth/logout');
    if (!hasRefreshCookie && !cookieRoute && req.headers.authorization?.startsWith('Bearer ')) {
      return true;
    }

    const allowed = new Set(this.config.get<string[]>('app.corsOrigins') ?? []);
    // The API's own origin (e.g. its Swagger UI) is same-origin by definition, never cross-site.
    const ownOrigin = originOf(this.config.get<string>('app.apiUrl'));
    if (ownOrigin) allowed.add(ownOrigin);
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (allowed.has(origin)) return true;
      throw rejected();
    }

    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'same-origin' || fetchSite === 'none') return true;
    if (fetchSite === 'cross-site') throw rejected('Cross-site request blocked');

    const referer = req.headers.referer;
    if (referer) {
      let refOrigin: string | undefined;
      try {
        refOrigin = new URL(referer).origin;
      } catch {
        refOrigin = undefined;
      }
      if (refOrigin && allowed.has(refOrigin)) return true;
      throw rejected();
    }

    if (fetchSite === undefined && this.config.get<string>('nodeEnv') !== 'production') {
      return true;
    }
    throw rejected();
  }
}
