import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';

export type AuthRequestUser = User & { sessionId: string; securityVersion: number };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthRequestUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthRequestUser }>();
    return request.user;
  },
);
