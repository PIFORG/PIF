import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { EmailService } from './email.service';

function configFor(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

describe('EmailService (preview transport)', () => {
  let dir: string;
  let values: Record<string, unknown>;
  const logs: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mtrs-mail-svc-'));
    values = {
      nodeEnv: 'development',
      'mail.transport': 'preview',
      'mail.previewDir': dir,
      'app.name': 'Market Trading Room Simulator',
      'app.frontendUrl': 'http://localhost:3000/',
      'smtp.from': 'MTRS <no-reply@localhost>',
    };
    logs.length = 0;
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(String(args[0]));
      });
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('captures the verification email with a canonical frontend link', async () => {
    const service = new EmailService(configFor(values));
    expect(service.mode).toBe('preview');
    await expect(service.sendVerification('ada@example.test', 'Ada', 'raw+token/1', 60)).resolves.toBe(true);

    const txt = readdirSync(dir).find((f) => f.endsWith('.txt'))!;
    const body = readFileSync(path.join(dir, txt), 'utf8');
    expect(body).toContain('http://localhost:3000/verify-email?token=raw%2Btoken%2F1');
    expect(body).toContain('This link expires in 1 hour and can be used only once.');
  });

  it('never writes the raw token or the full recipient address to logs', async () => {
    const service = new EmailService(configFor(values));
    await service.sendPasswordReset('ada.lovelace@example.test', 'Ada', 'super-secret-token', 30);
    const joined = logs.join('\n');
    expect(joined).toContain('captured to local preview (not delivered)');
    expect(joined).not.toContain('super-secret-token');
    expect(joined).not.toContain('ada.lovelace@example.test');
    expect(joined).toContain('ad***@example.test');
  });

  it('refuses the preview transport in production', () => {
    expect(() => new EmailService(configFor({ ...values, nodeEnv: 'production' }))).toThrow(
      /not allowed in production/,
    );
  });

  it('returns false instead of throwing when delivery fails', async () => {
    const failing = new EmailService(configFor(values));
    jest
      .spyOn((failing as unknown as { transport: { send: () => Promise<never> } }).transport, 'send')
      .mockRejectedValue(Object.assign(new Error('relay said no to bob@example.test'), { code: 'EENVELOPE' }));
    await expect(failing.sendWelcome('ada@example.test', 'Ada')).resolves.toBe(false);
    const joined = logs.join('\n');
    expect(joined).toContain('Email delivery failed');
    expect(joined).not.toContain('bob@example.test');
  });
});
