import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';
import { describeApiError } from '../core/api/errors';
import { RoomsApi, type RoomDetail } from '../core/api/rooms-api';
import { TokenStore } from '../core/auth/token-store';
import { formatMoney, formatNumber } from '../core/format/finance';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';

function idem(): string {
  return globalThis.crypto?.randomUUID?.() ?? `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

@Component({
  selector: 'mtr-room-session-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, FormsModule, RouterLink],
  host: { style: 'display: contents' },
  templateUrl: './room-session.page.html',
  styles: [
    `
      .rs-layout {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
      }
      @media (max-width: 960px) {
        .rs-layout {
          grid-template-columns: 1fr;
        }
      }
      .rs-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 0.65rem;
        margin-bottom: 1rem;
      }
      .rs-kpi {
        padding: 0.75rem;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--border, #1e3a5f) 45%, transparent);
      }
      .rs-kpi strong {
        display: block;
        font-variant-numeric: tabular-nums;
      }
      .rs-chat {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-height: 280px;
        overflow: auto;
      }
      .rs-msg {
        padding: 0.45rem 0.6rem;
        border-radius: 8px;
        background: color-mix(in srgb, var(--surface, #0b1c33) 70%, transparent);
      }
      .rs-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .rs-table {
        width: 100%;
        border-collapse: collapse;
      }
      .rs-table th,
      .rs-table td {
        text-align: left;
        padding: 0.4rem 0.35rem;
        border-bottom: 1px solid color-mix(in srgb, var(--border, #1e3a5f) 35%, transparent);
      }
      .rs-feed {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.35rem;
        max-height: 180px;
        overflow: auto;
      }
    `,
  ],
})
export class RoomSessionPage {
  private readonly api = inject(RoomsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly tokens = inject(TokenStore);
  private destroyed = false;
  private sinceSeq = 0;
  private pollTimer: number | null = null;
  private streamAbort: AbortController | null = null;

  protected readonly room = signal<RoomDetail | null>(null);
  protected readonly portfolio = signal<Record<string, unknown> | null>(null);
  protected readonly credit = signal<Record<string, unknown> | null>(null);
  protected readonly messages = signal<{ id: string; senderName: string; body: string; at: string }[]>([]);
  protected readonly events = signal<Record<string, unknown>[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly streamStatus = signal<'connecté' | 'reconnexion' | 'polling seul'>('polling seul');

  protected chatBody = '';
  protected convertPts = 50;
  protected creditAmount = 2000;
  protected repayAmount = 500;
  protected orderSymbol = 'CTB';
  protected orderQty = 10;
  protected orderSide: 'BUY' | 'SELL' = 'BUY';
  protected rewardRef = 'premiere-prise-de-position';

  protected readonly formatMoney = formatMoney;
  protected readonly formatNumber = formatNumber;

  protected readonly roomId = computed(() => this.route.snapshot.paramMap.get('id') ?? '');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      if (this.pollTimer != null) window.clearInterval(this.pollTimer);
      this.streamAbort?.abort();
    });
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    await this.reload();
    this.pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.pollState();
    }, 4000);
    this.openEventStream();
  }

  /** SSE via fetch + Authorization header (jamais de JWT dans l’URL). */
  private openEventStream(): void {
    const id = this.roomId();
    if (!id || this.destroyed) return;
    this.streamAbort?.abort();
    const ac = new AbortController();
    this.streamAbort = ac;
    const token = this.tokens.get();
    if (!token) {
      this.streamStatus.set('polling seul');
      return;
    }
    const url = `${environment.apiUrl}/rooms/${encodeURIComponent(id)}/events/stream`;
    void (async () => {
      try {
        const res = await fetch(url, {
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
          signal: ac.signal,
          credentials: 'include',
        });
        if (!res.ok || !res.body) {
          this.streamStatus.set('polling seul');
          return;
        }
        this.streamStatus.set('connecté');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!this.destroyed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
              if (typeof payload['seq'] === 'number') {
                this.ingestEvent(payload);
              }
            } catch {
              /* ignore malformed */
            }
          }
        }
        if (!this.destroyed) {
          this.streamStatus.set('reconnexion');
          window.setTimeout(() => this.openEventStream(), 2500);
        }
      } catch {
        if (!this.destroyed && !ac.signal.aborted) {
          this.streamStatus.set('reconnexion');
          window.setTimeout(() => this.openEventStream(), 2500);
        }
      }
    })();
  }

  private ingestEvent(ev: Record<string, unknown>): void {
    const seq = Number(ev['seq'] ?? 0);
    if (seq <= this.sinceSeq) return;
    this.sinceSeq = seq;
    this.events.update((cur) => {
      if (cur.some((e) => Number(e['seq']) === seq)) return cur;
      return [...cur, ev].slice(-40);
    });
    const type = String(ev['type'] ?? '');
    if (type.includes('CHAT') || ['ORDER_EVENT', 'CREDIT_GRANTED', 'POINTS_CONVERTED', 'POINTS_AWARDED', 'ROOM_ENDED', 'CLOCK_ADVANCED'].includes(type)) {
      void this.reload();
    }
  }

  private async reload(): Promise<void> {
    const id = this.roomId();
    if (!id) return;
    try {
      const detail = await this.api.detail(id);
      if (this.destroyed) return;
      this.room.set(detail);
      this.sinceSeq = detail.eventSeq ?? 0;
      const [msgs, pf, cr] = await Promise.all([
        this.api.messages(id),
        detail.you?.['portfolioId'] ? this.api.portfolio(id).catch(() => null) : Promise.resolve(null),
        detail.you?.['portfolioId'] ? this.api.credit(id).catch(() => null) : Promise.resolve(null),
      ]);
      if (this.destroyed) return;
      this.messages.set(msgs.messages);
      this.portfolio.set(pf);
      this.credit.set(cr);
      this.error.set(null);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Impossible de charger la salle.'));
    }
  }

  private async pollState(): Promise<void> {
    const id = this.roomId();
    if (!id || !this.room()) return;
    try {
      const state = await this.api.state(id, this.sinceSeq);
      if (this.destroyed) return;
      const ev = (state['events'] as Record<string, unknown>[]) ?? [];
      for (const e of ev) this.ingestEvent(e);
    } catch {
      // soft fail on poll
    }
  }

  protected async run(action: () => Promise<unknown>, ok: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.notice.set(ok);
      await this.reload();
    } catch (err) {
      this.error.set(describeApiError(err, 'Action refusée.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected start(): void {
    void this.run(() => this.api.start(this.roomId()), 'Simulation démarrée.');
  }
  protected pause(): void {
    void this.run(() => this.api.pause(this.roomId()), 'Salle en pause.');
  }
  protected end(): void {
    void this.run(() => this.api.end(this.roomId()), 'Session terminée.');
  }
  protected advance(): void {
    void this.run(() => this.api.advanceClock(this.roomId()), 'Horloge historique avancée.');
  }
  protected leave(): void {
    void this.run(() => this.api.leave(this.roomId()), 'Vous avez quitté la salle.');
  }

  protected async sendChat(): Promise<void> {
    const body = this.chatBody.trim();
    if (!body) return;
    await this.run(async () => {
      await this.api.postMessage(this.roomId(), body);
      this.chatBody = '';
    }, 'Message envoyé.');
  }

  protected convert(): void {
    void this.run(
      () => this.api.convertPoints(this.roomId(), this.convertPts, idem()),
      'Points convertis en capital fictif.',
    );
  }

  protected askCredit(): void {
    void this.run(
      () => this.api.requestCredit(this.roomId(), this.creditAmount, idem()),
      'Crédit virtuel accordé.',
    );
  }

  protected repay(): void {
    void this.run(
      () => this.api.repayCredit(this.roomId(), this.repayAmount, idem()),
      'Remboursement enregistré.',
    );
  }

  protected claimTutorial(): void {
    void this.run(
      () => this.api.claimReward(this.roomId(), 'TUTORIAL', this.rewardRef.trim() || 'tutorial-salle'),
      'Points d’apprentissage obtenus.',
    );
  }

  protected async trade(): Promise<void> {
    await this.run(async () => {
      const preview = await this.api.previewOrder(this.roomId(), {
        symbol: this.orderSymbol.trim().toUpperCase(),
        side: this.orderSide,
        type: 'MARKET',
        quantity: this.orderQty,
      });
      const quote = preview['quote'] as { asOf?: string } | undefined;
      const version = Number(preview['portfolioVersion'] ?? 0);
      await this.api.submitOrder(this.roomId(), {
        symbol: this.orderSymbol.trim().toUpperCase(),
        side: this.orderSide,
        type: 'MARKET',
        quantity: this.orderQty,
        clientOrderId: idem().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40).padEnd(8, '0'),
        expectedVersion: version,
        quoteAsOf: quote?.asOf,
      });
    }, 'Ordre simulé exécuté.');
  }

  protected num(v: unknown): number {
    return typeof v === 'number' ? v : Number(v ?? 0);
  }
}
