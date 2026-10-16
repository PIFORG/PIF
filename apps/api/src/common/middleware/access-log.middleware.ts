import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * One line per request. Logs the path only: query strings, bodies, headers, cookies and IP
 * addresses are never written, since they can carry tokens or personal data.
 */
@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const started = process.hrtime.bigint();
    const method = req.method;
    const path = (req.originalUrl ?? req.url).split('?')[0];
    res.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      const line = `${method} ${path} ${res.statusCode} ${durationMs}ms`;
      if (res.statusCode >= 500) this.logger.error(line);
      else if (res.statusCode >= 400) this.logger.warn(line);
      else this.logger.log(line);
    });
    next();
  }
}
