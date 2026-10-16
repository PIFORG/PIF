import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestUser } from '../decorators/current-user.decorator';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  sv: number;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['HS256'],
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
      issuer: config.getOrThrow<string>('jwt.issuer'),
      audience: config.getOrThrow<string>('jwt.audience'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthRequestUser> {
    if (!payload?.sub || !payload?.sid) {
      throw new UnauthorizedException({
        message: 'Invalid access token',
        errorCode: 'INVALID_TOKEN',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException({
        message: 'Invalid access token',
        errorCode: 'INVALID_TOKEN',
      });
    }

    if (user.status !== UserStatus.ACTIVE || !user.emailVerified) {
      throw new UnauthorizedException({
        message: 'Account is not eligible for access',
        errorCode: 'ACCOUNT_NOT_ELIGIBLE',
      });
    }

    if (payload.sv !== user.securityVersion) {
      throw new UnauthorizedException({
        message: 'Credentials were rotated; please sign in again',
        errorCode: 'CREDENTIALS_ROTATED',
      });
    }

    const session = await this.prisma.authSession.findFirst({
      where: {
        id: payload.sid,
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      throw new UnauthorizedException({
        message: 'Session is no longer active',
        errorCode: 'SESSION_REVOKED',
      });
    }

    // Soft last-active update (bounded frequency via skip if recent)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
    if (!user.lastActiveAt || user.lastActiveAt < fiveMinutesAgo) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      });
    }
    if (session.lastSeenAt < fiveMinutesAgo) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    return Object.assign(user, {
      sessionId: session.id,
      securityVersion: user.securityVersion,
    });
  }
}
