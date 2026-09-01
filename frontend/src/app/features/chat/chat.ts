import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { AccountRepository } from '../../data/account.repository';
import { AgentChatRepository } from '../../data/agent-chat.repository';
import { CategoryRepository } from '../../data/category.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import {
  AgentConversation,
  AgentConversationDetail,
  AgentStreamEvent,
} from '../../domain/models/agent-chat';
import { ConfirmService } from '../../core/confirm.service';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';

const OFF_TOPIC = '[[LF_OFF_TOPIC]]';

interface ChatTool {
  id: string;
  name: string;
  ok?: boolean;
}

interface PendingConfirm {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  tools: ChatTool[];
  pendingConfirm?: PendingConfirm;
}

interface ConfirmationEntry {
  labelKey?: string;
  label?: string;
  value: string;
}

/**
 * t(chat.title, chat.newChat, chat.empty.title, chat.empty.body, chat.composer.placeholder, chat.send, chat.offTopic, chat.thinking, chat.toolRunning, chat.toolDone, chat.confirm.title, chat.confirm.body, chat.confirm.approve, chat.confirm.reject, chat.confirm.account, chat.confirm.category, chat.confirm.institution, chat.delete.title, chat.delete.body, chat.errors.notConfigured, chat.errors.providerUnavailable, chat.errors.loopExhausted, chat.errors.generic)
 */
@Component({
  selector: 'app-chat',
  imports: [TranslocoDirective, DatePipe, Button, Card, EmptyState, Icon, Skeleton],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat {
  private readonly repo = inject(AgentChatRepository);
  private readonly accountRepository = inject(AccountRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly confirmService = inject(ConfirmService);

  protected readonly conversations = rxResource({ stream: () => this.repo.listConversations() });
  protected readonly conversationList = signal<AgentConversation[]>([]);
  protected readonly activeId = signal<string | null>(null);
  protected readonly detail = rxResource({
    params: () => this.activeId(),
    stream: ({ params }) => (params ? this.repo.getConversation(params) : of(null)),
  });
  protected readonly accounts = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly categories = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly institutions = rxResource({ stream: () => this.institutionRepository.list() });
  protected readonly liveMessages = signal<ChatTurn[]>([]);
  protected readonly sending = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly refused = signal(false);
  protected readonly composer = signal('');
  /**
   * The conversation id whose persisted messages have already been folded
   * into `liveMessages`. The `detail` resource reloads after every streamed
   * turn (for the title), and re-seeding on each reload would clobber the
   * text just streamed into the bubbles - so we seed a conversation exactly
   * once, when it becomes active.
   */
  private seededFor: string | null = null;

  constructor() {
    effect(() => {
      const rows = this.conversations.value();
      if (rows) this.conversationList.set(rows);
    });
    effect(() => {
      const id = this.activeId();
      const conversation = this.detail.value();
      if (!id) {
        this.liveMessages.set([]);
        this.refused.set(false);
        this.seededFor = null;
      } else if (conversation?.id === id && this.seededFor !== id) {
        const turns = this.toChatTurns(conversation);
        this.liveMessages.set(turns);
        this.refused.set(turns.some((turn) => turn.text === OFF_TOPIC));
        this.seededFor = id;
      }
    });
  }

  protected selectConversation(id: string): void {
    this.errorKey.set(null);
    this.refused.set(false);
    this.liveMessages.set([]);
    this.seededFor = null;
    this.activeId.set(id);
  }

  protected newChat(): void {
    this.errorKey.set(null);
    this.repo.createConversation().subscribe({
      next: (conversation) => {
        this.conversationList.update((rows) => [conversation, ...rows]);
        this.conversations.reload();
        this.liveMessages.set([]);
        this.seededFor = conversation.id;
        this.activeId.set(conversation.id);
      },
      error: (error: unknown) => this.setError(error),
    });
  }

  protected send(text: string): void {
    const content = text.trim();
    const id = this.activeId();
    if (
      !content ||
      !id ||
      this.sending() ||
      this.detail.value()?.status === 'awaiting_confirmation' ||
      this.liveMessages().some((turn) => turn.pendingConfirm)
    )
      return;

    this.composer.set('');
    this.errorKey.set(null);
    this.refused.set(false);
    this.liveMessages.update((turns) => [
      ...turns,
      { role: 'user', text: content, tools: [] },
      { role: 'assistant', text: '', tools: [] },
    ]);
    this.readStream(this.repo.sendMessage(id, content));
  }

  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    this.send((event.target as HTMLTextAreaElement).value);
  }

  protected confirmTool(confirm: PendingConfirm, approved: boolean): void {
    const id = this.activeId();
    if (!id || this.sending()) return;
    this.updateLastAssistant((turn) => ({ ...turn, pendingConfirm: undefined }));
    this.readStream(this.repo.confirm(id, confirm.id, approved));
  }

  protected async deleteConversation(id: string): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'chat.delete.title',
      'chat.delete.body',
      'danger',
    );
    if (!confirmed) return;
    this.repo.deleteConversation(id).subscribe({
      next: () => {
        this.conversationList.update((rows) => rows.filter((row) => row.id !== id));
        if (this.activeId() === id) this.activeId.set(null);
        this.conversations.reload();
      },
      error: (error: unknown) => this.setError(error),
    });
  }

  protected confirmationEntries(args: Record<string, unknown>): ConfirmationEntry[] {
    return Object.entries(args).map(([key, value]) => ({
      ...(this.isAccountKey(key) ? { labelKey: 'chat.confirm.account' } : {}),
      ...(this.isCategoryKey(key) ? { labelKey: 'chat.confirm.category' } : {}),
      ...(this.isInstitutionKey(key) ? { labelKey: 'chat.confirm.institution' } : {}),
      ...(!this.isAccountKey(key) && !this.isCategoryKey(key) && !this.isInstitutionKey(key)
        ? { label: key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()) }
        : {}),
      value: this.displayArgument(key, value),
    }));
  }

  private readStream(stream: Observable<AgentStreamEvent>): void {
    this.sending.set(true);
    this.errorKey.set(null);
    stream.subscribe({
      next: (event) => this.applyEvent(event),
      error: (error: unknown) => this.setError(error),
      complete: () => this.sending.set(false),
    });
  }

  private applyEvent(event: AgentStreamEvent): void {
    switch (event.type) {
      case 'delta':
        this.updateLastAssistant((turn) => ({ ...turn, text: turn.text + event.text }));
        break;
      case 'tool_call':
        this.updateLastAssistant((turn) => ({
          ...turn,
          tools: [...turn.tools, { id: event.id, name: event.name }],
        }));
        break;
      case 'tool_result':
        this.updateLastAssistant((turn) => ({
          ...turn,
          tools: turn.tools.map((tool) =>
            tool.id === event.id ? { ...tool, ok: event.ok } : tool,
          ),
        }));
        break;
      case 'tool_confirm':
        this.updateLastAssistant((turn) => ({
          ...turn,
          pendingConfirm: { id: event.id, name: event.name, arguments: event.arguments },
        }));
        break;
      case 'refusal':
        this.refused.set(true);
        this.updateLastAssistant((turn) => ({ ...turn, text: OFF_TOPIC }));
        break;
      case 'error':
        this.errorKey.set(this.errorKeyFor(event.code));
        this.sending.set(false);
        break;
      case 'done':
        this.sending.set(false);
        // Refresh the list (titles/status); the thread stays as streamed -
        // re-fetching `detail` here would clobber the live bubbles.
        this.conversations.reload();
        break;
    }
  }

  private updateLastAssistant(update: (turn: ChatTurn) => ChatTurn): void {
    this.liveMessages.update((turns) => {
      let index = turns.length - 1;
      while (index >= 0 && turns[index].role !== 'assistant') index--;
      if (index < 0) return turns;
      const next = [...turns];
      next[index] = update(next[index]);
      return next;
    });
  }

  private toChatTurns(conversation: AgentConversationDetail): ChatTurn[] {
    const turns: ChatTurn[] = [];
    for (const message of [...conversation.messages].sort((a, b) => a.position - b.position)) {
      if (message.role === 'tool') {
        const assistant = [...turns].reverse().find((turn) => turn.role === 'assistant');
        if (!assistant) continue;
        const tool = assistant.tools.find((item) => item.id === message.toolCallId);
        if (tool) tool.ok = !message.isError;
        else if (message.toolCallId && message.toolName) {
          assistant.tools.push({
            id: message.toolCallId,
            name: message.toolName,
            ok: !message.isError,
          });
        }
        continue;
      }
      turns.push({
        role: message.role === 'user' ? 'user' : 'assistant',
        text: message.content,
        tools: message.toolCalls?.map((tool) => ({ id: tool.id, name: tool.name })) ?? [],
      });
    }
    return turns;
  }

  private isAccountKey(key: string): boolean {
    return key === 'account' || key === 'account_id' || key === 'accountId';
  }

  private isCategoryKey(key: string): boolean {
    return key === 'category' || key === 'category_id' || key === 'categoryId';
  }

  private isInstitutionKey(key: string): boolean {
    return key === 'institution' || key === 'institution_id' || key === 'institutionId';
  }

  private displayArgument(key: string, value: unknown): string {
    if (this.isAccountKey(key)) {
      return (
        this.accounts.value()?.find((account) => account.id === String(value))?.name ??
        String(value)
      );
    }
    if (this.isCategoryKey(key)) {
      return (
        this.categories.value()?.find((category) => category.id === String(value))?.name ??
        String(value)
      );
    }
    if (this.isInstitutionKey(key)) {
      return (
        this.institutions.value()?.find((institution) => institution.id === String(value))?.name ??
        String(value)
      );
    }
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  }

  private errorKeyFor(code: string): string {
    return (
      {
        'agents.not_configured': 'chat.errors.notConfigured',
        'agents.provider_unavailable': 'chat.errors.providerUnavailable',
        'agents.loop_exhausted': 'chat.errors.loopExhausted',
      }[code] ?? 'chat.errors.generic'
    );
  }

  private setError(error: unknown): void {
    this.sending.set(false);
    const code =
      error instanceof ApiError
        ? error.code
        : typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
    this.errorKey.set(this.errorKeyFor(code));
  }
}
