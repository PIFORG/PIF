import { LoggerService } from '@nestjs/common';
import { currentCorrelationId } from '../request-context';

type Sink = (line: string) => void;

/**
 * Structured (one JSON object per line) logger for production log pipelines. Every entry
 * carries the request correlation ID when one is in scope.
 */
export class JsonLogger implements LoggerService {
  constructor(
    private readonly out: Sink = (line) => process.stdout.write(line + '\n'),
    private readonly err: Sink = (line) => process.stderr.write(line + '\n'),
  ) {}

  log(message: unknown, ...optional: unknown[]) {
    this.write('info', message, optional);
  }

  warn(message: unknown, ...optional: unknown[]) {
    this.write('warn', message, optional);
  }

  error(message: unknown, ...optional: unknown[]) {
    this.write('error', message, optional);
  }

  debug(message: unknown, ...optional: unknown[]) {
    this.write('debug', message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]) {
    this.write('verbose', message, optional);
  }

  private write(level: string, message: unknown, optional: unknown[]) {
    // Nest passes the context name last; for error() a stack trace may precede it.
    const rest = [...optional];
    const context = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    const stack = level === 'error' && typeof rest[0] === 'string' ? (rest.shift() as string) : undefined;
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      context,
      correlationId: currentCorrelationId(),
      message: message instanceof Error ? message.message : message,
    };
    if (message instanceof Error && message.stack) entry.stack = message.stack;
    else if (stack) entry.stack = stack;
    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') this.err(line);
    else this.out(line);
  }
}
