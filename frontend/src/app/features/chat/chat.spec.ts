import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { Subject, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AgentChatRepository } from '../../data/agent-chat.repository';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { InvestmentAssetRepository } from '../../data/investment-asset.repository';
import { InvestmentWalletRepository } from '../../data/investment-wallet.repository';
import { MockAgentChatRepository } from '../../data/mock/mock-agent-chat.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockCategoryGroupRepository } from '../../data/mock/mock-category-group.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MockInvestmentAssetRepository } from '../../data/mock/mock-investment-asset.repository';
import { MockInvestmentWalletRepository } from '../../data/mock/mock-investment-wallet.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { ConfirmService } from '../../core/confirm.service';
import { ApiError } from '../../core/api-error';
import { AgentConversationDetail, AgentStreamEvent } from '../../domain/models/agent-chat';
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
      { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
      { provide: InstitutionRepository, useClass: MockInstitutionRepository },
      { provide: InvestmentAssetRepository, useClass: MockInvestmentAssetRepository },
      { provide: InvestmentWalletRepository, useClass: MockInvestmentWalletRepository },
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
    fixture.detectChanges();

    expect(fixture.componentInstance['activeId']()).toBe('c1');
    expect(fixture.componentInstance['showList']()).toBe(false);
    expect(fixture.nativeElement.querySelector('.chat-conversations').classList).toContain(
      'chat-mobile-hidden',
    );
    expect(fixture.nativeElement.querySelector('.chat-thread-panel').classList).not.toContain(
      'chat-mobile-hidden',
    );

    fixture.componentInstance['showList'].set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.chat-conversations').classList).not.toContain(
      'chat-mobile-hidden',
    );
    expect(fixture.nativeElement.querySelector('.chat-thread-panel').classList).toContain(
      'chat-mobile-hidden',
    );
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

  it('copies the plain text from an assistant code block', async () => {
    const fixture = setup();
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();
    const codeText = '# Orçamento\n\n- Moradia\n- Alimentação\n';
    fixture.componentInstance['liveMessages'].set([
      { role: 'assistant', text: `\`\`\`markdown\n${codeText}\`\`\``, tools: [] },
    ]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    fixture.detectChanges();

    try {
      const copyControl = fixture.nativeElement.querySelector('.md-code-copy') as HTMLElement;
      copyControl.click();
      await fixture.whenStable();

      expect(writeText).toHaveBeenCalledWith(codeText);
      const copiedLabel = TestBed.inject(TranslocoService).translate('layout.update.modal.copied');
      expect(copyControl.getAttribute('aria-label')).toBe(copiedLabel);
      expect(copyControl.classList).toContain('md-code-copy--copied');
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('keeps tool activity collapsed until the user expands it', async () => {
    const fixture = setup();
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();
    const chat = fixture.componentInstance;
    const stream = new Subject<AgentStreamEvent>();
    chat['repo'].sendMessage = vi.fn().mockReturnValue(stream.asObservable());

    chat['send']('How did I spend this month?');
    chat['applyEvent']({
      type: 'tool_call',
      id: 't1',
      name: 'search_transactions',
      arguments: {},
    });
    fixture.detectChanges();

    const activity = fixture.nativeElement.querySelector(
      'details.chat-activity',
    ) as HTMLDetailsElement;
    const transloco = TestBed.inject(TranslocoService);
    expect(activity.open).toBe(false);
    expect(activity.closest('.chat-message-body')).toBeNull();
    expect(activity.querySelector('summary')?.textContent).toContain(
      transloco.translate('chat.thinking'),
    );

    activity.open = true;
    expect(activity.textContent).toContain('search_transactions');
    expect(activity.textContent).toContain(transloco.translate('chat.toolRunning'));

    chat['applyEvent']({
      type: 'tool_result',
      id: 't1',
      name: 'search_transactions',
      ok: true,
    });
    chat['applyEvent']({ type: 'done', status: 'idle', messageId: 'm1' });
    fixture.detectChanges();

    expect(activity.textContent).toContain(transloco.translate('chat.toolDone'));
  });

  it('cancels the active stream before switching conversations', () => {
    const fixture = setup();
    const chat = fixture.componentInstance;
    const stream = new Subject<AgentStreamEvent>();
    chat['repo'].sendMessage = vi.fn().mockReturnValue(stream.asObservable());
    chat['activeId'].set('c1');
    chat['liveMessages'].set([{ role: 'assistant', text: '', tools: [] }]);

    chat['send']('hello');
    chat['selectConversation']('c2');
    expect(chat['showList']()).toBe(false);
    chat['liveMessages'].set([{ role: 'assistant', text: 'new', tools: [] }]);
    stream.next({ type: 'delta', text: ' stale' });

    expect(chat['sending']()).toBe(false);
    expect(chat['liveMessages']().at(-1)?.text).toBe('new');
  });

  it('reopens the active conversation without clearing its messages', () => {
    const fixture = setup();
    const chat = fixture.componentInstance;
    chat['activeId'].set('c1');
    chat['liveMessages'].set([{ role: 'assistant', text: 'loaded', tools: [] }]);
    chat['showList'].set(true);

    chat['selectConversation']('c1');

    expect(chat['showList']()).toBe(false);
    expect(chat['liveMessages']().at(-1)?.text).toBe('loaded');
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
      preview: { amount: '9.99' },
    });
    expect(chat['liveMessages']().at(-1)?.pendingConfirm?.id).toBe('w1');
    expect(chat['liveMessages']().at(-1)?.pendingConfirm?.preview).toEqual({ amount: '9.99' });

    chat['applyEvent']({ type: 'refusal', code: 'agents.off_topic' });
    expect(chat['refused']()).toBe(true);
    expect(chat['liveMessages']().at(-1)?.text).toBe('[[LF_OFF_TOPIC]]');

    chat['applyEvent']({ type: 'error', code: 'agents.provider_unavailable', params: {} });
    expect(chat['errorKey']()).toBe('chat.errors.providerUnavailable');
    expect(chat['sending']()).toBe(false);
  });

  it('resumes text after a refusal and read tool without exposing the marker', () => {
    const chat = setup().componentInstance;
    chat['liveMessages'].set([{ role: 'assistant', text: '', tools: [] }]);

    chat['applyEvent']({ type: 'refusal', code: 'agents.off_topic' });
    chat['applyEvent']({ type: 'delta', text: '' });
    expect(chat['liveMessages']().at(-1)?.text).toBe('[[LF_OFF_TOPIC]]');
    chat['applyEvent']({ type: 'tool_call', id: 'r1', name: 'list_accounts', arguments: {} });
    chat['applyEvent']({ type: 'tool_result', id: 'r1', name: 'list_accounts', ok: true });
    chat['applyEvent']({ type: 'delta', text: 'Balance: ' });
    chat['applyEvent']({ type: 'delta', text: '100' });

    expect(chat['liveMessages']().at(-1)?.text).toBe('Balance: 100');
    expect(chat['liveMessages']().at(-1)?.tools).toEqual([
      { id: 'r1', name: 'list_accounts', ok: true },
    ]);
  });

  it.each([
    ['', '[[LF_OFF_TOPIC]]', '[[LF_OFF_TOPIC]]'],
    ['[[LF_OFF_TOPIC]]', 'Balance: 100', 'Balance: 100'],
    ['[[LF_OFF_TOPIC]]', '', '[[LF_OFF_TOPIC]]'],
    ['Checking accounts.', '# Balance\n100', 'Checking accounts.\n\n# Balance\n100'],
    ['Checking accounts.', '[[LF_OFF_TOPIC]]', '[[LF_OFF_TOPIC]]'],
  ])(
    'folds persisted tool rounds with preamble %j and response %j',
    (preamble, response, expected) => {
      const fixture = setup();
      const detail: AgentConversationDetail = {
        id: 'c9',
        title: 't',
        provider: 'anthropic',
        model: 'm',
        status: 'idle',
        pendingCallId: null,
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
            content: preamble,
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
            content: '',
            toolCalls: [{ id: 'c2', name: 'monthly_totals', arguments: {} }],
            toolCallId: null,
            toolName: null,
            isError: false,
            position: 3,
            createdAt: '',
          },
          {
            id: 'm4',
            role: 'tool',
            content: '{}',
            toolCalls: null,
            toolCallId: 'c2',
            toolName: 'monthly_totals',
            isError: false,
            position: 4,
            createdAt: '',
          },
          {
            id: 'm5',
            role: 'assistant',
            content: response,
            toolCalls: null,
            toolCallId: null,
            toolName: null,
            isError: false,
            position: 5,
            createdAt: '',
          },
          {
            id: 'm6',
            role: 'user',
            content: 'next question',
            toolCalls: null,
            toolCallId: null,
            toolName: null,
            isError: false,
            position: 6,
            createdAt: '',
          },
          {
            id: 'm7',
            role: 'assistant',
            content: 'Separate answer',
            toolCalls: null,
            toolCallId: null,
            toolName: null,
            isError: false,
            position: 7,
            createdAt: '',
          },
        ],
      };

      const turns = fixture.componentInstance['toChatTurns'](detail);

      expect(turns).toHaveLength(4);
      expect(turns[1].tools).toEqual([
        { id: 'c1', name: 'spend_by_category', ok: true },
        { id: 'c2', name: 'monthly_totals', ok: true },
      ]);
      expect(turns[1].text).toBe(expected);
      expect(turns[3].text).toBe('Separate answer');
    },
  );

  it('rehydrates the exact pending persisted tool call', () => {
    const fixture = setup();
    const turns = fixture.componentInstance['toChatTurns']({
      id: 'c9',
      title: 't',
      provider: 'anthropic',
      model: 'm',
      status: 'awaiting_confirmation',
      pendingCallId: 'w1',
      createdAt: '',
      updatedAt: '',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'w1',
              name: 'delete_category_structure',
              arguments: {
                category_ids: ['c1', 'unknown-category'],
                group_ids: ['g1', 'unknown-group'],
              },
            },
          ],
          toolCallId: null,
          toolName: null,
          isError: false,
          position: 0,
          createdAt: '',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'w2', name: 'delete_category_structure', arguments: {} }],
          toolCallId: null,
          toolName: null,
          isError: false,
          position: 1,
          createdAt: '',
        },
      ],
    });

    expect(turns).toHaveLength(1);
    expect(turns[0].pendingConfirm?.id).toBe('w1');
  });

  it('labels confirmation entries and resolves account and category ids', async () => {
    const fixture = setup();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const accounts = fixture.componentInstance['accounts'].value() ?? [];
    const categories = fixture.componentInstance['categories'].value() ?? [];
    const groups = fixture.componentInstance['groups'].value() ?? [];
    const institutions = fixture.componentInstance['institutions'].value() ?? [];

    const entries = fixture.componentInstance['confirmationEntries']({
      account_id: accounts[0]?.id ?? 'x',
      category_id: categories[0]?.id ?? 'y',
      category_ids: [categories[0]?.id ?? 'y', 'unknown-category'],
      group_ids: [groups[0]?.id ?? 'z', 'unknown-group'],
      institution_id: institutions[0]?.id ?? 'z',
      amount: '10',
      meta: { a: 1 },
    });

    expect(entries.find((e) => e.labelKey === 'chat.confirm.account')?.value).toBe(
      accounts[0]?.name ?? 'x',
    );
    expect(entries.find((e) => e.labelKey === 'chat.confirm.category')?.value).toBe(
      categories[0]?.name ?? 'y',
    );
    expect(entries.find((e) => e.value.includes('unknown-category'))).toMatchObject({
      labelKey: 'chat.confirm.category',
      value: `${categories[0]?.name ?? 'y'}, unknown-category`,
    });
    expect(entries.find((e) => e.value.includes('unknown-group'))).toMatchObject({
      labelKey: 'chat.confirm.group',
      value: `${groups[0]?.name ?? 'z'}, unknown-group`,
    });
    expect(entries.find((e) => e.labelKey === 'chat.confirm.institution')?.value).toBe(
      institutions[0]?.name ?? 'z',
    );
    expect(entries.find((e) => e.label === 'Amount')?.value).toBe('10');
    expect(entries.find((e) => e.label === 'Meta')?.value).toBe('{"a":1}');
  });

  it('overlays investment preview values and resolves wallet, asset, and settlement accounts', async () => {
    const fixture = setup();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const chat = fixture.componentInstance;
    const account = chat['accounts'].value()?.[0];
    const wallet = chat['investmentWallets'].value()?.[0];
    const asset = chat['investmentAssets'].value()?.[0];
    expect(account && wallet && asset).toBeTruthy();

    const entries = chat['confirmationEntries'](
      {
        entity: 'investment_transaction',
        data: {
          wallet_id: wallet!.id,
          asset_id: asset!.id,
          type: 'buy',
          amount: '105',
          fee: '5',
        },
      },
      {
        amount: '100',
        quantity: '10',
        price: '10',
        settlement: {
          amount: '105',
          currency: 'BRL',
          source_account_id: account!.id,
          destination_account_id: account!.id,
          conversion: null,
        },
      },
    );

    expect(entries.find((entry) => entry.label === 'Wallet')?.value).toBe(wallet!.name);
    expect(entries.find((entry) => entry.label === 'Asset')?.value).toBe(asset!.name);
    expect(entries.find((entry) => entry.label === 'Amount')?.value).toBe('100');
    expect(entries.find((entry) => entry.label === 'Quantity')?.value).toBe('10');
    expect(entries.find((entry) => entry.label === 'Price')?.value).toBe('10');
    expect(entries.filter((entry) => entry.labelKey === 'chat.confirm.account')).toHaveLength(2);
    expect(
      entries
        .filter((entry) => entry.labelKey === 'chat.confirm.account')
        .every((entry) => entry.value === account!.name),
    ).toBe(true);
  });

  it('shows the fields nested in create and update arguments as their own rows', async () => {
    const fixture = setup();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const accounts = fixture.componentInstance['accounts'].value() ?? [];

    const created = fixture.componentInstance['confirmationEntries']({
      entity: 'transaction',
      data: { account_id: accounts[0]?.id ?? 'x', amount: '10', meta: { a: 1 } },
    });
    const updated = fixture.componentInstance['confirmationEntries']({
      entity: 'goal',
      id: 'goal-1',
      changes: { archived: true },
    });

    expect(created.map((entry) => entry.label ?? entry.labelKey)).toEqual([
      'Entity',
      'chat.confirm.account',
      'Amount',
      'Meta',
    ]);
    expect(created.find((e) => e.labelKey === 'chat.confirm.account')?.value).toBe(
      accounts[0]?.name ?? 'x',
    );
    expect(created.find((e) => e.label === 'Meta')?.value).toBe('{"a":1}');
    expect(created.some((entry) => entry.label === 'Data')).toBe(false);
    expect(updated.map((entry) => [entry.label, entry.value])).toEqual([
      ['Entity', 'goal'],
      ['Id', 'goal-1'],
      ['Archived', 'true'],
    ]);
  });

  it('runs the confirm-tool stream and clears the pending card', async () => {
    const fixture = setup();
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();
    const reload = vi.spyOn(fixture.componentInstance['detail'], 'reload');
    fixture.componentInstance['liveMessages'].set([
      {
        role: 'assistant',
        text: '',
        tools: [],
        pendingConfirm: { id: 'w1', name: 'x', arguments: {} },
      },
    ]);

    fixture.componentInstance['confirmTool']({ id: 'w1', name: 'x', arguments: {} }, true);
    await fixture.whenStable();

    expect(fixture.componentInstance['liveMessages']().at(-1)?.pendingConfirm).toBeUndefined();
    expect(fixture.componentInstance['liveMessages']().at(-1)?.text).toContain('confirmed');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the message list mounted while the conversation reloads', async () => {
    const fixture = setup();
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();
    fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('.chat-messages');
    expect(list).not.toBeNull();

    const pending = new Subject<AgentConversationDetail>();
    fixture.componentInstance['repo'].getConversation = vi.fn().mockReturnValue(pending);
    fixture.componentInstance['detail'].reload();
    fixture.detectChanges();

    expect(fixture.componentInstance['detail'].status()).toBe('reloading');
    expect(fixture.nativeElement.querySelector('app-skeleton')).toBeNull();
    expect(fixture.nativeElement.querySelector('.chat-messages')).toBe(list);
  });

  it('follows new messages to the bottom unless the user scrolled up', async () => {
    const fixture = setup();
    fixture.detectChanges();
    fixture.componentInstance['newChat']();
    await fixture.whenStable();
    fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('.chat-messages') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });
    const turns = (text: string) => [{ role: 'assistant' as const, text, tools: [] }];

    fixture.componentInstance['liveMessages'].set(turns('one'));
    fixture.detectChanges();
    expect(list.scrollTop).toBe(900);

    list.scrollTop = 100;
    list.dispatchEvent(new Event('scroll'));
    fixture.componentInstance['liveMessages'].set(turns('two'));
    fixture.detectChanges();
    expect(list.scrollTop).toBe(100);

    fixture.componentInstance['send']('hi');
    fixture.detectChanges();
    expect(list.scrollTop).toBe(900);
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
    chat['setError']({ code: 'agents.tool_loop_exhausted' });
    expect(chat['errorKey']()).toBe('chat.errors.loopExhausted');
  });

  it('surfaces a create-conversation failure as an error key', () => {
    const fixture = setup();
    const chat = fixture.componentInstance;
    chat['repo'].createConversation = () =>
      throwError(() => new ApiError(422, 'agents.not_configured', {}));

    chat['newChat']();
    fixture.detectChanges();

    expect(chat['errorKey']()).toBe('chat.errors.notConfigured');
    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // Below md the thread pane is hidden while the list shows; the alert must
    // not live inside it (or any other mobile-hidden container).
    expect(alert.closest('.max-md\\:hidden')).toBeNull();
  });
});
