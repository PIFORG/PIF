import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export type MailTransportMode = 'preview' | 'smtp';

export const MAIL_TRANSPORT_MODES: readonly MailTransportMode[] = ['preview', 'smtp'];

export interface OutgoingMail {
  template: string;
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * What actually happened to a message. `captured` means it was written to the local preview
 * folder and never left the machine; `smtp-accepted` means the relay accepted it, which is
 * not proof of inbox delivery.
 */
export type MailDeliveryResult =
  | { state: 'captured'; messageId: string; previewId: string }
  | { state: 'smtp-accepted'; messageId: string; accepted: string[]; rejected: string[] }
  | { state: 'failed'; reason: string; attempts: number };

export interface MailTransport {
  readonly mode: MailTransportMode;
  send(mail: OutgoingMail): Promise<MailDeliveryResult>;
  verify(): Promise<void>;
}

export interface PreviewMeta {
  id: string;
  template: string;
  to: string;
  subject: string;
  createdAt: string;
}

const PREVIEW_ID_PATTERN = /^[0-9]{8}T[0-9]{9}Z-[a-z0-9-]{1,60}-[0-9a-f]{8}$/;

export function isPreviewId(id: string): boolean {
  return PREVIEW_ID_PATTERN.test(id);
}

function compactTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:.]/g, '');
}

/**
 * Development transport: renders the full RFC 5322 message with Nodemailer's stream
 * transport (CRLF line endings) and stores it as `.eml` plus `.html`/`.txt` renditions.
 * Nothing is sent over the network.
 */
export class PreviewMailTransport implements MailTransport {
  readonly mode = 'preview' as const;
  private readonly transporter: Transporter;

  constructor(
    private readonly dir: string,
    private readonly keep = 200,
  ) {
    this.transporter = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'windows',
    });
  }

  get directory(): string {
    return this.dir;
  }

  async verify(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.access(this.dir);
  }

  async send(mail: OutgoingMail): Promise<MailDeliveryResult> {
    await fs.mkdir(this.dir, { recursive: true });
    const now = new Date();
    const slug = mail.template.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60) || 'message';
    const id = `${compactTimestamp(now)}-${slug}-${randomBytes(4).toString('hex')}`;
    const info = await this.transporter.sendMail({
      from: mail.from,
      to: mail.to,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      headers: { 'X-MTRS-Template': mail.template },
    });
    const raw = (info as { message?: Buffer | string }).message;
    if (!raw) throw new Error('Preview transport produced no message body');
    const meta: PreviewMeta = {
      id,
      template: mail.template,
      to: mail.to,
      subject: mail.subject,
      createdAt: now.toISOString(),
    };
    const base = path.join(this.dir, id);
    await fs.writeFile(`${base}.eml`, raw);
    await fs.writeFile(`${base}.html`, mail.html, 'utf8');
    await fs.writeFile(`${base}.txt`, mail.text, 'utf8');
    await fs.writeFile(`${base}.json`, JSON.stringify(meta, null, 2), 'utf8');
    await this.prune();
    return { state: 'captured', messageId: String(info.messageId ?? ''), previewId: id };
  }

  private async prune(): Promise<void> {
    const ids = (await fs.readdir(this.dir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter(isPreviewId)
      .sort();
    const stale = ids.slice(0, Math.max(0, ids.length - this.keep));
    for (const id of stale) {
      for (const ext of ['.eml', '.html', '.txt', '.json']) {
        await fs.rm(path.join(this.dir, `${id}${ext}`), { force: true });
      }
    }
  }
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user?: string;
  pass?: string;
}

const TRANSIENT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'ECONNREFUSED']);

/** 4xx SMTP replies and network-level failures may succeed later; 5xx and auth errors never will. */
export function isTransientMailError(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number };
  if (typeof e?.responseCode === 'number') return e.responseCode >= 400 && e.responseCode < 500;
  return typeof e?.code === 'string' && TRANSIENT_CODES.has(e.code);
}

export class SmtpMailTransport implements MailTransport {
  readonly mode = 'smtp' as const;
  private readonly transporter: Transporter;

  constructor(
    settings: SmtpSettings,
    private readonly retryDelaysMs: readonly number[] = [1_000, 4_000],
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: !settings.secure && settings.requireTls,
      auth: settings.user ? { user: settings.user, pass: settings.pass ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { minVersion: 'TLSv1.2' },
    });
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async send(mail: OutgoingMail): Promise<MailDeliveryResult> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const info = await this.transporter.sendMail({
          from: mail.from,
          to: mail.to,
          replyTo: mail.replyTo,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          headers: { 'X-MTRS-Template': mail.template },
        });
        const accepted = ((info.accepted ?? []) as Array<string | { address: string }>).map((a) =>
          typeof a === 'string' ? a : a.address,
        );
        const rejected = ((info.rejected ?? []) as Array<string | { address: string }>).map((a) =>
          typeof a === 'string' ? a : a.address,
        );
        if (accepted.length === 0) {
          return { state: 'failed', reason: 'Recipient rejected by SMTP relay', attempts: attempt };
        }
        return { state: 'smtp-accepted', messageId: String(info.messageId ?? ''), accepted, rejected };
      } catch (err) {
        const delay = this.retryDelaysMs[attempt - 1];
        if (delay === undefined || !isTransientMailError(err)) {
          const e = err as { code?: string; message?: string };
          const reason = [e?.code, e?.message].filter((p) => p && String(p).trim()).join(' ');
          return { state: 'failed', reason: reason || 'unknown error', attempts: attempt };
        }
        await this.sleep(delay);
      }
    }
  }
}
