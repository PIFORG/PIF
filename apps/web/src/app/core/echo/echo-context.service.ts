import { Injectable, computed, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import type { EchoClientContext } from './echo-api';

/** Module of a workspace path; ÉCHO uses it only to disambiguate a question. */
export function moduleOf(path: string): string {
  if (path.startsWith('/learn/sessions')) return 'MISSION';
  if (path.startsWith('/learn')) return 'MARKETQUEST';
  const first = path.split('/')[1] ?? '';
  const known: Record<string, string> = {
    markets: 'MARKETS',
    trading: 'TRADING',
    portfolios: 'PORTFOLIOS',
    risk: 'RISK',
    backtesting: 'BACKTESTING',
    strategies: 'BACKTESTING',
    stories: 'STORIES',
    actuarial: 'ACTUARIAL',
    stress: 'STRESS',
    ai: 'AI',
    dashboard: 'DASHBOARD',
    rooms: 'ROOMS',
  };
  return known[first] ?? 'WORKSPACE';
}

/**
 * What the current page lets ÉCHO know (selected instrument, portfolio, mission, order draft).
 * These are hints: the server re-checks ownership of every identifier. Context published by a page
 * is cleared when the user navigates elsewhere.
 */
@Injectable({ providedIn: 'root' })
export class EchoContextService {
  private readonly router = inject(Router);
  private readonly published = signal<{ path: string; ctx: EchoClientContext }>({ path: '', ctx: {} });
  private readonly pendingQuestion = signal<{ text: string; id: number } | null>(null);
  private seq = 0;

  readonly path = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0] || '/'),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] || '/' },
  );

  readonly context = computed<EchoClientContext>(() => {
    const path = this.path();
    const pub = this.published();
    const own = pub.path === path ? pub.ctx : {};
    return { route: path, module: moduleOf(path), ...own };
  });

  readonly question = this.pendingQuestion.asReadonly();

  /** Called by pages; merges with what this page already published. */
  publish(ctx: EchoClientContext): void {
    // Pages call this from effects: reads must not become dependencies of the caller's effect,
    // otherwise the write below would re-trigger it forever.
    untracked(() => {
      const path = this.path();
      const prev = this.published();
      const next = prev.path === path ? { ...prev.ctx, ...ctx } : ctx;
      if (prev.path === path && JSON.stringify(next) === JSON.stringify(prev.ctx)) return;
      this.published.set({ path, ctx: next });
    });
  }

  /** Opens ÉCHO with a question (e.g. the "Examiner avec ÉCHO" button of the order ticket). */
  askEcho(text: string): void {
    this.pendingQuestion.set({ text, id: ++this.seq });
  }

  consumeQuestion(id: number): void {
    if (this.pendingQuestion()?.id === id) this.pendingQuestion.set(null);
  }
}
