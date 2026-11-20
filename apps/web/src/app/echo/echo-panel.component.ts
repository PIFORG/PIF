import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { describeApiError } from '../core/api/errors';
import {
  EchoApi,
  type EchoAction,
  type EchoAlert,
  type EchoAnswer,
  type EchoClientContext,
  type EchoDecision,
  type EchoPreferences,
} from '../core/echo/echo-api';
import { EchoContextService } from '../core/echo/echo-context.service';
import { EchoVoiceService } from '../core/echo/echo-voice.service';
import { EchoAnswerComponent } from './echo-answer.component';

type Tab = 'chat' | 'journal' | 'alerts' | 'settings';
interface Turn {
  id: number;
  question: string;
  answer: EchoAnswer | null;
  error: string | null;
}

const MODULE_LABELS: Record<string, string> = {
  MARKETS: 'Marchés',
  TRADING: 'Trading',
  PORTFOLIOS: 'Portefeuilles',
  RISK: 'Risques',
  BACKTESTING: 'Backtesting',
  MARKETQUEST: 'MarketQuest',
  MISSION: 'Mission',
  STORIES: 'FinStories',
  ACTUARIAL: 'Actuariat',
  STRESS: 'Stress bancaire',
  AI: 'IA',
  DASHBOARD: 'Tableau de bord',
  ROOMS: 'Salles',
  WORKSPACE: 'Espace investisseur',
};

const SUGGESTIONS: Record<string, string[]> = {
  TRADING: ['Examiner le risque de cet ordre', 'Peux-tu analyser cet actif ?'],
  MARKETS: ['Peux-tu analyser cet actif ?', 'Compare la volatilité de ces deux instruments.'],
  PORTFOLIOS: ['Analyser ma diversification', 'Quelle est la performance de mon portefeuille ?'],
  RISK: ['Pourquoi mon risque est-il à ce niveau ?', 'Quel serait l\'impact d\'une baisse simulée de 10 % ?'],
  MISSION: ['Expliquer ma dernière décision', 'Qu\'est-ce que la diversification ?'],
  MARKETQUEST: ['Quelle décision ai-je prise lors de ma dernière mission ?', 'Qu\'aurais-je pu faire différemment ?'],
  STORIES: ['Explique-moi mon dernier épisode FinStories.'],
  ACTUARIAL: ['Comprendre ce résultat', 'Qu\'est-ce que le ratio combiné ?'],
  STRESS: ['Pourquoi cette banque est-elle vulnérable ?', 'Qu\'est-ce que le CET1 ?'],
};
const DEFAULT_SUGGESTIONS = ['Quelle est la performance de mon portefeuille ?', 'Explique-moi ce que signifie la VaR.'];
const ALIASES: Record<string, string> = {
  'Analyser ma diversification': 'Quels actifs représentent ma plus grande exposition ?',
  'Expliquer ma dernière décision': 'Quelle décision ai-je prise lors de ma dernière mission ?',
  'Comprendre ce résultat': 'Pourquoi cette prime est-elle élevée ?',
};
const POLL_MS = 60_000;

/** ÉCHO launcher + contextual side panel, mounted once in the investor shell. */
@Component({
  selector: 'mtr-echo-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EchoAnswerComponent],
  styleUrl: './echo-panel.component.css',
  templateUrl: './echo-panel.component.html',
})
export class EchoPanelComponent {
  private readonly api = inject(EchoApi);
  private readonly router = inject(Router);
  protected readonly ctx = inject(EchoContextService);
  protected readonly voice = inject(EchoVoiceService);

  protected readonly open = signal(false);
  protected readonly tab = signal<Tab>('chat');
  protected readonly turns = signal<Turn[]>([]);
  protected readonly draft = signal('');
  protected readonly busy = signal(false);
  protected readonly conversationId = signal<string | null>(null);
  protected readonly prefs = signal<EchoPreferences | null>(null);
  protected readonly prefsError = signal<string | null>(null);
  protected readonly alerts = signal<EchoAlert[]>([]);
  protected readonly decisions = signal<EchoDecision[] | null>(null);
  protected readonly intents = signal<{ id: string; label: string }[]>([]);
  protected readonly journalError = signal<string | null>(null);
  protected readonly reviewing = signal<string | null>(null);
  protected readonly unavailable = signal<string | null>(null);
  protected readonly intentForm = signal({ intent: 'DIVERSIFICATION', intentNote: '', hypothesis: '' });

  protected readonly unread = computed(() => this.alerts().filter((a) => !a.read).length);
  protected readonly moduleLabel = computed(() => MODULE_LABELS[this.ctx.context().module ?? ''] ?? 'Espace investisseur');
  protected readonly contextChips = computed(() => {
    const c = this.ctx.context();
    const chips: string[] = [this.moduleLabel()];
    if (c.symbol) chips.push(c.symbol);
    if (c.orderDraft) chips.push(`Ordre ${c.orderDraft.side === 'BUY' ? 'achat' : 'vente'} ${c.orderDraft.quantity}`);
    return chips;
  });
  protected readonly suggestions = computed(() => SUGGESTIONS[this.ctx.context().module ?? ''] ?? DEFAULT_SUGGESTIONS);

  private readonly launcher = viewChild<ElementRef<HTMLButtonElement>>('launcher');
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private seq = 0;
  private readonly spoken = new Set<string>();
  private extraContext: Record<string, unknown> = {};

  constructor() {
    const destroyRef = inject(DestroyRef);
    void this.loadPrefs();
    void this.pollAlerts(false);
    const timer = window.setInterval(() => void this.pollAlerts(false), POLL_MS);
    destroyRef.onDestroy(() => {
      window.clearInterval(timer);
      this.voice.stop();
    });

    // Navigation stops ÉCHO's voice (never FinStories').
    effect(() => {
      this.ctx.path();
      untracked(() => this.voice.stop());
    });

    // "Examiner avec ÉCHO" buttons on pages.
    effect(() => {
      const q = this.ctx.question();
      if (!q) return;
      untracked(() => {
        this.ctx.consumeQuestion(q.id);
        this.show('chat');
        void this.send(q.text);
      });
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.open()) {
        this.close();
      } else if (e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        if (this.open()) this.close();
        else this.show('chat');
      }
    };
    document.addEventListener('keydown', onKey);
    destroyRef.onDestroy(() => document.removeEventListener('keydown', onKey));
  }

  protected show(tab: Tab): void {
    this.open.set(true);
    this.tab.set(tab);
    if (tab === 'journal') void this.loadJournal();
    if (tab === 'alerts') void this.pollAlerts(true);
    window.setTimeout(() => this.input()?.nativeElement.focus(), 0);
  }

  protected close(): void {
    this.open.set(false);
    this.voice.stop();
    this.voice.stopListening();
    window.setTimeout(() => this.launcher()?.nativeElement.focus(), 0);
  }

  protected newConversation(): void {
    this.conversationId.set(null);
    this.turns.set([]);
    this.extraContext = {};
    this.voice.stop();
  }

  // ------------------------------------------------------------------ conversation

  protected async send(text?: string): Promise<void> {
    const raw = (text ?? this.draft()).trim();
    if (!raw || this.busy()) return;
    const question = ALIASES[raw] ?? raw;
    this.draft.set('');
    const id = ++this.seq;
    this.turns.update((t) => [...t, { id, question: raw, answer: null, error: null }]);
    this.busy.set(true);
    const context: EchoClientContext = { ...this.ctx.context(), ...this.extraContext };
    try {
      const res = await this.api.ask(question, context, this.conversationId());
      this.conversationId.set(res.conversationId);
      this.unavailable.set(null);
      this.turns.update((t) => t.map((x) => (x.id === id ? { ...x, answer: res.message } : x)));
      if (this.prefs()?.voiceEnabled) this.voice.say(res.message.speech ?? res.message.answer, 'answer');
    } catch (err) {
      const message = describeApiError(err, "ÉCHO n'a pas pu répondre. Aucune donnée n'a été inventée : réessayez.");
      this.turns.update((t) => t.map((x) => (x.id === id ? { ...x, error: message } : x)));
    } finally {
      this.busy.set(false);
      window.setTimeout(() => {
        const el = this.log()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, 0);
    }
  }

  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.send();
    }
  }

  protected onAction(a: EchoAction): void {
    if (a.kind === 'NAVIGATE' && a.route) {
      void this.router.navigateByUrl(a.route);
      if (window.matchMedia?.('(max-width: 720px)').matches) this.close();
      return;
    }
    if (a.question) void this.send(a.question);
  }

  protected onChoose(o: { label: string; message?: string; context?: Record<string, unknown> }): void {
    if (o.context) {
      this.extraContext = { ...this.extraContext, ...o.context };
      const last = [...this.turns()].reverse().find((t) => t.answer)?.question;
      void this.send(last ?? o.label);
    } else {
      void this.send(o.message ?? o.label);
    }
  }

  protected async talk(): Promise<void> {
    const text = await this.voice.listenOnce();
    if (text) this.draft.set(text); // transcription is shown for confirmation, never auto-sent
    this.input()?.nativeElement.focus();
  }

  // ------------------------------------------------------------------ preferences

  private async loadPrefs(): Promise<void> {
    try {
      const p = await this.api.preferences();
      this.prefs.set(p);
      this.voice.enabled.set(p.voiceEnabled);
    } catch (err) {
      this.unavailable.set(describeApiError(err, 'ÉCHO est indisponible sur cet environnement.'));
    }
  }

  protected async savePrefs(patch: Partial<EchoPreferences>): Promise<void> {
    this.prefsError.set(null);
    try {
      const p = await this.api.savePreferences(patch);
      this.prefs.set(p);
      this.voice.enabled.set(p.voiceEnabled);
      if (!p.voiceEnabled) this.voice.stop();
    } catch (err) {
      this.prefsError.set(describeApiError(err, 'Préférences non enregistrées.'));
    }
  }

  // ------------------------------------------------------------------ alerts

  private async pollAlerts(force: boolean): Promise<void> {
    try {
      const res = await this.api.alerts(force);
      this.alerts.set(res.alerts);
      // Speak at most one newly raised, important alert per poll, and each alert only once.
      if (res.proactiveVoice && this.prefs()?.voiceEnabled && res.raised.length) {
        const first = res.alerts.find((a) => !a.read && a.severity !== 'INFO' && !this.spoken.has(a.id));
        if (first) {
          this.spoken.add(first.id);
          this.voice.say(`Attention. ${first.message}`, 'alert');
        }
      }
    } catch {
      // Alerts are optional; the panel stays usable.
    }
  }

  protected async readAlert(a: EchoAlert): Promise<void> {
    if (!a.read) {
      await this.api.markRead(a.id).catch(() => undefined);
      this.alerts.update((list) => list.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
    }
    if (a.action?.route) void this.router.navigateByUrl(a.action.route);
  }

  protected async dismissAlert(a: EchoAlert): Promise<void> {
    await this.api.dismiss(a.id).catch(() => undefined);
    this.alerts.update((list) => list.filter((x) => x.id !== a.id));
  }

  protected speakAlert(a: EchoAlert): void {
    this.voice.say(`${a.title}. ${a.message}`, 'alert');
  }

  // ------------------------------------------------------------------ journal

  protected async loadJournal(): Promise<void> {
    this.journalError.set(null);
    try {
      const res = await this.api.decisions();
      this.decisions.set(res.decisions);
      this.intents.set(res.intents);
    } catch (err) {
      this.journalError.set(describeApiError(err, 'Journal indisponible.'));
    }
  }

  protected patchIntent(key: 'intent' | 'intentNote' | 'hypothesis', value: string): void {
    this.intentForm.update((f) => ({ ...f, [key]: value }));
  }

  protected async saveIntent(): Promise<void> {
    const c = this.ctx.context();
    const f = this.intentForm();
    this.journalError.set(null);
    try {
      await this.api.createDecision({
        intent: f.intent,
        intentNote: f.intentNote || null,
        hypothesis: f.hypothesis || null,
        portfolioId: c.portfolioId ?? null,
        symbol: c.orderDraft?.symbol ?? c.symbol ?? null,
        side: c.orderDraft?.side ?? null,
        quantity: c.orderDraft?.quantity ?? null,
      });
      this.intentForm.set({ intent: f.intent, intentNote: '', hypothesis: '' });
      await this.loadJournal();
    } catch (err) {
      this.journalError.set(describeApiError(err, "L'intention n'a pas été enregistrée."));
    }
  }

  protected async review(d: EchoDecision): Promise<void> {
    this.reviewing.set(d.id);
    try {
      const res = await this.api.reviewDecision(d.id);
      this.decisions.update((list) => (list ?? []).map((x) => (x.id === d.id ? res.decision : x)));
    } catch (err) {
      this.journalError.set(describeApiError(err, 'Bilan impossible.'));
    } finally {
      this.reviewing.set(null);
    }
  }

  protected async removeDecision(d: EchoDecision): Promise<void> {
    await this.api.deleteDecision(d.id).catch(() => undefined);
    this.decisions.update((list) => (list ?? []).filter((x) => x.id !== d.id));
  }

  protected intentLabel(id: string): string {
    return this.intents().find((i) => i.id === id)?.label ?? id;
  }

  protected async forgetConversations(): Promise<void> {
    await this.api.deleteConversations().catch(() => undefined);
    this.newConversation();
  }
}
