import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import * as nodemailer from 'nodemailer';
import {
  isPreviewId,
  isTransientMailError,
  type OutgoingMail,
  PreviewMailTransport,
  SmtpMailTransport,
} from './mail-transport';

const mail: OutgoingMail = {
  template: 'verify-email',
  from: 'MTRS <no-reply@mtrs-sim.com>',
  to: 'ada@example.test',
  subject: 'Verify your email for MTRS',
  text: 'Hi Ada,\n\nConfirm: https://app/verify-email?token=abc',
  html: '<!DOCTYPE html><html><body><p>Hi Ada</p></body></html>',
};

describe('PreviewMailTransport', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mtrs-mail-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a real RFC 5322 multipart message plus HTML, text and metadata renditions', async () => {
    const result = await new PreviewMailTransport(dir).send(mail);
    expect(result.state).toBe('captured');
    if (result.state !== 'captured') return;
    expect(isPreviewId(result.previewId)).toBe(true);

    const files = readdirSync(dir).sort();
    expect(files).toEqual(['.eml', '.html', '.json', '.txt'].map((e) => `${result.previewId}${e}`).sort());

    const eml = readFileSync(path.join(dir, `${result.previewId}.eml`), 'utf8');
    expect(eml).toMatch(/^From: MTRS <no-reply@mtrs-sim\.com>\r$/m);
    expect(eml).toMatch(/^To: ada@example\.test\r$/m);
    expect(eml).toMatch(/^Subject: Verify your email for MTRS\r$/m);
    expect(eml).toMatch(/^Message-ID: <.+>\r$/m);
    expect(eml).toMatch(/^Date: .+\r$/m);
    expect(eml).toContain('multipart/alternative');
    expect(eml).toContain('Content-Type: text/plain');
    expect(eml).toContain('Content-Type: text/html');
    expect(eml).toContain('\r\n');

    const meta = JSON.parse(readFileSync(path.join(dir, `${result.previewId}.json`), 'utf8'));
    expect(meta).toMatchObject({ template: 'verify-email', to: 'ada@example.test', subject: mail.subject });
  });

  it('keeps only the newest messages', async () => {
    const transport = new PreviewMailTransport(dir, 2);
    for (let i = 0; i < 4; i += 1) {
      await transport.send({ ...mail, template: `t${i}` });
      await new Promise((r) => setTimeout(r, 5));
    }
    const kept = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(kept).toHaveLength(2);
    expect(kept.some((f) => f.includes('-t3-'))).toBe(true);
    expect(kept.some((f) => f.includes('-t0-'))).toBe(false);
  });

  it('rejects path-like identifiers', () => {
    expect(isPreviewId('../../etc/passwd')).toBe(false);
    expect(isPreviewId('20261016T000745329Z-verify-email-6865fa3c')).toBe(true);
  });
});

describe('isTransientMailError', () => {
  it.each([
    [{ responseCode: 421 }, true],
    [{ responseCode: 451 }, true],
    [{ responseCode: 550 }, false],
    [{ responseCode: 535, code: 'EAUTH' }, false],
    [{ code: 'ECONNECTION' }, true],
    [{ code: 'ETIMEDOUT' }, true],
    [{ code: 'EAUTH' }, false],
    [{ code: 'EENVELOPE' }, false],
    [new Error('boom'), false],
  ])('%j -> %s', (err, expected) => {
    expect(isTransientMailError(err)).toBe(expected);
  });
});

describe('SmtpMailTransport', () => {
  const settings = { host: 'smtp.relay.test', port: 587, secure: false, requireTls: true, user: 'u', pass: 'p' };
  let sendMail: jest.Mock;
  let createSpy: jest.SpyInstance;

  beforeEach(() => {
    sendMail = jest.fn();
    createSpy = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail, verify: jest.fn() } as unknown as ReturnType<typeof nodemailer.createTransport>);
  });
  afterEach(() => createSpy.mockRestore());

  it('requires STARTTLS on non-implicit-TLS ports and enforces TLS 1.2+', () => {
    new SmtpMailTransport(settings);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ requireTLS: true, secure: false, tls: { minVersion: 'TLSv1.2' } }),
    );
  });

  it('reports SMTP acceptance (not delivery) with accepted recipients', async () => {
    sendMail.mockResolvedValue({ messageId: '<m1>', accepted: ['ada@example.test'], rejected: [] });
    const result = await new SmtpMailTransport(settings, [], async () => undefined).send(mail);
    expect(result).toEqual({ state: 'smtp-accepted', messageId: '<m1>', accepted: ['ada@example.test'], rejected: [] });
  });

  it('retries transient failures with bounded backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    sendMail
      .mockRejectedValueOnce(Object.assign(new Error('try later'), { responseCode: 421 }))
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
      .mockResolvedValue({ messageId: '<m2>', accepted: ['ada@example.test'], rejected: [] });
    const result = await new SmtpMailTransport(settings, [10, 20], async (ms) => {
      sleeps.push(ms);
    }).send(mail);
    expect(result.state).toBe('smtp-accepted');
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('gives up after the configured attempts', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('try later'), { responseCode: 451 }));
    const result = await new SmtpMailTransport(settings, [1, 1], async () => undefined).send(mail);
    expect(result).toMatchObject({ state: 'failed', attempts: 3 });
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('never retries permanent failures such as bad credentials', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 }));
    const result = await new SmtpMailTransport(settings, [1, 1], async () => undefined).send(mail);
    expect(result).toMatchObject({ state: 'failed', attempts: 1 });
  });

  it('treats a relay that rejects every recipient as a failure', async () => {
    sendMail.mockResolvedValue({ messageId: '<m3>', accepted: [], rejected: ['ada@example.test'] });
    const result = await new SmtpMailTransport(settings, [], async () => undefined).send(mail);
    expect(result.state).toBe('failed');
  });
});
