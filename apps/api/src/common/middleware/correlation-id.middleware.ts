import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { CORRELATION_ID_PATTERN, requestContext } from '../request-context';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-correlation-id') || req.header('x-request-id');
    const correlationId = incoming && CORRELATION_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    (req as Request & { correlationId: string }).correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    requestContext.run({ correlationId }, () => next());
  }
}
