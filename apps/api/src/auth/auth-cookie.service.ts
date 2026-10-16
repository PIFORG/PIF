import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService) {}

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('cookie.secure') ?? false,
      sameSite: this.config.get<'strict' | 'lax' | 'none'>('cookie.sameSite') ?? 'lax',
      path: this.config.get<string>('cookie.path') ?? '/api/auth',
      domain: this.config.get<string>('cookie.domain') || undefined,
    };
  }

  name(): string {
    return this.config.get<string>('cookie.name') ?? 'mtrs_refresh';
  }

  setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.name(), token, {
      ...this.cookieOptions(),
      expires: expiresAt,
    });
  }

  clearRefreshCookie(res: Response): void {
    res.clearCookie(this.name(), this.cookieOptions());
  }
}
