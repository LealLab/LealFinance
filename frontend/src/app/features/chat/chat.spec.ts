import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { AgentChatRepository } from '../../data/agent-chat.repository';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { MockAgentChatRepository } from '../../data/mock/mock-agent-chat.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { ConfirmService } from '../../core/confirm.service';
import { ApiError } from '../../core/api-error';
import { AgentConversationDetail } from '../../domain/models/agent-chat';
import { provideTestTransloco } from '../../../testing/transloco';
import { Chat } from './chat';

function setup(confirmResult = true) {
  const confirmService = { confirm: () => Promise.resolve(confirmResult) };
  TestBed.configureTestingModule({
    imports: [Chat, provideTestTransloco()],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: MOCK_LATENCY_MS, useValue: 0 },
      { provide: AgentChatRepository, useClass: MockAgentChatRepository },
      { provide: AccountRepository, useClass: MockAccountRepository },
      { provide: CategoryRepository, useClass: MockCategoryRepository },
      { provide: ConfirmService, useValue: confirmService },
    ],
  });
  return TestBed.createComponent(Chat);
}

describe('Chat', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the empty state', () => {
    const fixture = setup();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-empty-state')).not.toBeNull();
  });

  it('creates and selects a new conversation', async () => {
    const fixture = setup();
    fixture.detectChanges();

    fixture.componentInstance['newChat']();
    await fixture.whenStable();

    expect(fixture.componentInstance['activeId']()).toBe('c1');
  });

  it('streams mock deltas into a bubble and clears sending on done', async () => {
    const fixture = setup();
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();

    fixture.componentInstance['send']('Ola');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['liveMessages']().at(-1)?.text).toBe('Mock: Ola');
    expect(fixture.componentInstance['sending']()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Mock: Ola');
  });

  it('applies every stream event onto the last assistant turn', () => {
    const fixture = setup();
    const chat = fixture.componentInstance;
    chat['liveMessages'].set([
      { role: 'user', text: 'hi', tools: [] },
      { role: 'assistant', text: '', tools: [] },
    ]);

    chat['applyEvent']({ type: 'delta', text: 'He' });
    chat['applyEvent']({ type: 'delta', text: 'llo' });
    chat['applyEvent']({ type: 'tool_call', id: 't1', name: 'search_transactions', arguments: {} });
    chat['applyEvent']({ type: 'tool_result', id: 't1', name: 'search_transactions', ok: true });
    expect(chat['liveMessages']().at(-1)?.text).toBe('Hello');
    expect(chat['liveMessages']().at(-1)?.tools).toEqual([
      { id: 't1', name: 'search_transactions', ok: true },
    ]);

    chat['applyEvent']({
      type: 'tool_confirm',
      id: 'w1',
      name: 'create_transaction',
      arguments: { amount: '10' },
    });
    expect(chat['liveMessages']().at(-1)?.pendingConfirm?.id).toBe('w1');

    chat['applyEvent']({ type: 'refusal', code: 'agents.off_topic' });
    expect(chat['refused']()).toBe(true);
    expect(chat['liveMessages']().at(-1)?.text).toBe('[[LF_OFF_TOPIC]]');

    chat['applyEvent']({ type: 'error', code: 'agents.provider_unavailable', params: {} });
    expect(chat['errorKey']()).toBe('chat.errors.providerUnavailable');
    expect(chat['sending']()).toBe(false);
  });

  it('folds persisted tool messages onto their assistant turn', () => {
    const fixture = setup();
    const detail: AgentConversationDetail = {
      id: 'c9',
      title: 't',
      provider: 'anthropic',
      model: 'm',
      status: 'idle',
      createdAt: '',
      updatedAt: '',
      messages: [
        {
          id: 'm0',
          role: 'user',
          content: 'spend?',
          toolCalls: null,
          toolCallId: null,
          toolName: null,
          isError: false,
          position: 0,
          createdAt: '',
        },
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'spend_by_category', arguments: {} }],
          toolCallId: null,
          toolName: null,
          isError: false,
          position: 1,
          createdAt: '',
        },
        {
          id: 'm2',
          role: 'tool',
          content: '[]',
          toolCalls: null,
          toolCallId: 'c1',
          toolName: 'spend_by_category',
          isError: false,
          position: 2,
          createdAt: '',
        },
        {
          id: 'm3',
          role: 'assistant',
          content: '[[LF_OFF_TOPIC]]',
          toolCalls: null,
          toolCallId: null,
          toolName: null,
          isError: false,
          position: 3,
          createdAt: '',
        },
      ],
    };

    const turns = fixture.componentInstance['toChatTurns'](detail);

    expect(turns).toHaveLength(3);
    expect(turns[1].tools).toEqual([{ id: 'c1', name: 'spend_by_category', ok: true }]);
    expect(turns[2].text).toBe('[[LF_OFF_TOPIC]]');
  });

  it('labels confirmation entries and resolves account and category ids', async () => {
    const fixture = setup();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const accounts = fixture.componentInstance['accounts'].value() ?? [];
    const categories = fixture.componentInstance['categories'].value() ?? [];

    const entries = fixture.componentInstance['confirmationEntries']({
      account_id: accounts[0]?.id ?? 'x',
      category_id: categories[0]?.id ?? 'y',
      amount: '10',
      meta: { a: 1 },
    });

    expect(entries.find((e) => e.labelKey === 'chat.confirm.account')?.value).toBe(
      accounts[0]?.name ?? 'x',
    );
    expect(entries.find((e) => e.labelKey === 'chat.confirm.category')?.value).toBe(
      categories[0]?.name ?? 'y',
    );
    expect(entries.find((e) => e.label === 'Amount')?.value).toBe('10');
    expect(entries.find((e) => e.label === 'Meta')?.value).toBe('{"a":1}');
  });

  it('runs the confirm-tool stream and clears the pending card', async () => {
    const fixture = setup();
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();
    fixture.componentInstance['liveMessages'].set([
      { role: 'assistant', text: '', tools: [], pendingConfirm: { id: 'w1', name: 'x', arguments: {} } },
    ]);

    fixture.componentInstance['confirmTool']({ id: 'w1', name: 'x', arguments: {} }, true);
    await fixture.whenStable();

    expect(fixture.componentInstance['liveMessages']().at(-1)?.pendingConfirm).toBeUndefined();
    expect(fixture.componentInstance['liveMessages']().at(-1)?.text).toContain('confirmed');
  });

  it('deletes a conversation after confirmation', async () => {
    const fixture = setup(true);
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();
    const id = fixture.componentInstance['activeId']()!;

    await fixture.componentInstance['deleteConversation'](id);
    await fixture.whenStable();

    expect(fixture.componentInstance['activeId']()).toBeNull();
    expect(fixture.componentInstance['conversationList']().some((c) => c.id === id)).toBe(false);
  });

  it('keeps the conversation when deletion is not confirmed', async () => {
    const fixture = setup(false);
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();
    const id = fixture.componentInstance['activeId']()!;

    await fixture.componentInstance['deleteConversation'](id);
    await fixture.whenStable();

    expect(fixture.componentInstance['activeId']()).toBe(id);
  });

  it('sends on Enter but not on Shift+Enter', async () => {
    const fixture = setup();
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();
    const chat = fixture.componentInstance;
    const target = { value: 'typed' } as HTMLTextAreaElement;

    chat['onComposerKeydown']({
      key: 'Enter',
      shiftKey: true,
      preventDefault: () => undefined,
      target,
    } as unknown as KeyboardEvent);
    expect(chat['liveMessages']()).toHaveLength(0);

    chat['onComposerKeydown']({
      key: 'Enter',
      shiftKey: false,
      preventDefault: () => undefined,
      target,
    } as unknown as KeyboardEvent);
    await fixture.whenStable();
    expect(chat['liveMessages']().length).toBeGreaterThan(0);
  });

  it('maps error inputs to translation keys', () => {
    const fixture = setup();
    const chat = fixture.componentInstance;

    expect(chat['errorKeyFor']('agents.not_configured')).toBe('chat.errors.notConfigured');
    expect(chat['errorKeyFor']('something.else')).toBe('chat.errors.generic');

    chat['setError'](new ApiError(422, 'agents.not_configured', {}));
    expect(chat['errorKey']()).toBe('chat.errors.notConfigured');
    chat['setError']({ code: 'agents.loop_exhausted' });
    expect(chat['errorKey']()).toBe('chat.errors.loopExhausted');
  });

  it('surfaces a create-conversation failure as an error key', () => {
    const fixture = setup();
    const chat = fixture.componentInstance;
    chat['repo'].createConversation = () =>
      throwError(() => new ApiError(422, 'agents.not_configured', {}));

    chat['newChat']();

    expect(chat['errorKey']()).toBe('chat.errors.notConfigured');
  });
});
