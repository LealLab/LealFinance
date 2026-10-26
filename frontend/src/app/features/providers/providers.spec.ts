import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { AgentChatRepository } from '../../data/agent-chat.repository';
import { AgentProviderRepository } from '../../data/agent-provider.repository';
import { MockAgentProviderRepository } from '../../data/mock/mock-agent-provider.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { AgentProviderStatus } from '../../domain/models/agent-provider';
import { McpTokenSummary } from '../../domain/models/agent-chat';
import { Providers } from './providers';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Providers', () => {
  const SUMMARY: McpTokenSummary = {
    id: 't1',
    name: 'Desktop',
    scope: 'write',
    createdAt: '2026-08-01T00:00:00Z',
    lastUsedAt: null,
    expiresAt: '2026-09-01T00:00:00Z',
  };
  let agentChatRepo: {
    mintMcpToken: ReturnType<typeof vi.fn>;
    listMcpTokens: ReturnType<typeof vi.fn>;
    revokeMcpToken: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    agentChatRepo = {
      mintMcpToken: vi.fn().mockReturnValue(of({ ...SUMMARY, token: 'mcp-secret' })),
      listMcpTokens: vi.fn().mockReturnValue(of([SUMMARY])),
      revokeMcpToken: vi.fn().mockReturnValue(of(undefined)),
    };
    await TestBed.configureTestingModule({
      imports: [
        Providers,
        provideTestTransloco(),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideTestTranslocoLocale(),
        provideRouter([]),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AgentProviderRepository, useClass: MockAgentProviderRepository },
        { provide: AgentChatRepository, useValue: agentChatRepo },
      ],
    }).compileComponents();
  });

  it('renders every provider, unconfigured by default', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = fixture.componentInstance['providersResource'].value() ?? [];
    expect(rows.map(({ provider, configured, source }) => ({ provider, configured, source }))).toEqual([
      { provider: 'anthropic', configured: false, source: 'none' },
      { provider: 'openai', configured: false, source: 'none' },
      { provider: 'ollama', configured: false, source: 'none' },
    ]);
  });

  it('generates and displays an MCP token', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance['generateMcpToken']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(agentChatRepo.mintMcpToken).toHaveBeenCalledTimes(1);
    // Read-only and unnamed unless the admin chooses otherwise.
    expect(agentChatRepo.mintMcpToken).toHaveBeenCalledWith({ scope: 'read', name: undefined });
    expect(
      (fixture.nativeElement.querySelector('#providers-mcp-token') as HTMLInputElement).value,
    ).toBe('mcp-secret');
    // The list is reloaded so the new token appears.
    expect(agentChatRepo.listMcpTokens).toHaveBeenCalledTimes(2);
  });

  it('sends the chosen scope and name, and warns before a write token is created', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#providers-mcp-write-warning')).toBeNull();

    const select = fixture.nativeElement.querySelector('#providers-mcp-scope') as HTMLSelectElement;
    select.value = 'write';
    select.dispatchEvent(new Event('change'));
    const name = fixture.nativeElement.querySelector('#providers-mcp-name') as HTMLInputElement;
    name.value = '  Claude Desktop ';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#providers-mcp-write-warning')).not.toBeNull();
    fixture.componentInstance['generateMcpToken']();
    await fixture.whenStable();

    expect(agentChatRepo.mintMcpToken).toHaveBeenCalledWith({
      scope: 'write',
      name: 'Claude Desktop',
    });
    expect(fixture.componentInstance['mcpName']()).toBe('');
  });

  it('lists the active tokens without any secret', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const list = fixture.nativeElement.querySelector('#providers-mcp-token-list') as HTMLElement;
    expect(list.querySelectorAll('li')).toHaveLength(1);
    expect(list.textContent).toContain('Desktop');
  });

  it('revokes a token after confirmation and reloads the list', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockImplementation(confirm);
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // A freshly created secret for the same token must stop being offered.
    fixture.componentInstance['mcpToken'].set({ ...SUMMARY, token: 'mcp-secret' });

    await fixture.componentInstance['revokeMcpToken'](SUMMARY);
    await fixture.whenStable();

    expect(confirm).toHaveBeenCalledWith(
      'providers.mcpTokens.revokeTitle',
      'providers.mcpTokens.revokeMessage',
      'danger',
    );
    expect(agentChatRepo.revokeMcpToken).toHaveBeenCalledWith('t1');
    expect(fixture.componentInstance['mcpToken']()).toBeUndefined();
    expect(agentChatRepo.listMcpTokens).toHaveBeenCalledTimes(2);
  });

  it('does not revoke when the confirmation is declined, and reports a failed revoke', async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockImplementation(confirm);
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance['revokeMcpToken'](SUMMARY);
    expect(agentChatRepo.revokeMcpToken).not.toHaveBeenCalled();

    agentChatRepo.revokeMcpToken.mockReturnValue(throwError(() => new Error('boom')));
    await fixture.componentInstance['revokeMcpToken'](SUMMARY);
    expect(fixture.componentInstance['mcpRevokeError']()).toBe(true);
  });

  it('opens MCP setup help from the question mark button', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const helpButton = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === '?',
    ) as HTMLButtonElement;
    helpButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance['mcpHelpOpen']()).toBe(true);
    expect((fixture.nativeElement.querySelector('dialog') as HTMLDialogElement).open).toBe(true);
  });

  it('marks only Ollama as experimental', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const providerCards = [...fixture.nativeElement.querySelectorAll('app-card')].slice(0, 3);
    expect(providerCards.map((card) => card.querySelectorAll('app-badge').length)).toEqual([1, 1, 2]);
  });

  it('links a provider with an api key and reflects it as configured', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const repository = TestBed.inject(AgentProviderRepository);
    let linked: unknown;
    repository.link('anthropic', { apiKey: 'sk-test' }).subscribe((status) => (linked = status));
    fixture.componentInstance['providersResource'].reload();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(linked).toMatchObject({ provider: 'anthropic', configured: true, source: 'user' });
  });

  it('opens the link modal for the chosen provider', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const provider: AgentProviderStatus = {
      provider: 'openai',
      configured: false,
      source: 'none',
      authModes: ['api_key', 'oauth'],
      model: 'gpt-6-luna',
      defaultModel: 'gpt-6-luna',
      models: [],
      reasoningEfforts: [],
    };
    fixture.componentInstance['openLink'](provider);

    expect(fixture.componentInstance['linkModalOpen']()).toBe(true);
    expect(fixture.componentInstance['linkModalProvider']()).toEqual(provider);
  });

  it('tests a configured provider connection and shows the result', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('anthropic', { apiKey: 'sk-test' }).subscribe(() => resolve()),
    );

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const provider = fixture.componentInstance['providersResource']
      .value()
      ?.find((row) => row.provider === 'anthropic');
    fixture.componentInstance['testConnection'](provider!);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['testResult']()).toEqual({ provider: 'anthropic', ok: true });
  });

  it('shows no model picker for an unconfigured provider', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#provider-model-anthropic')).toBeNull();
  });

  it('shows a model select for a user-linked provider, marking the recommended option', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('anthropic', { apiKey: 'sk-test' }).subscribe(() => resolve()),
    );

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#provider-model-anthropic');
    expect(select).not.toBeNull();
    const recommended = [...select.options].find((o) => o.value === 'claude-sonnet-5');
    expect(recommended?.selected).toBe(true);
  });

  it('changing the model select links the new model and keeps the provider configured', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('anthropic', { apiKey: 'sk-test' }).subscribe(() => resolve()),
    );

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#provider-model-anthropic');
    select.value = 'claude-opus-5-5';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    const updated = fixture.componentInstance['providersResource']
      .value()
      ?.find((row) => row.provider === 'anthropic');
    expect(updated?.model).toBe('claude-opus-5-5');
    expect(updated?.configured).toBe(true);
  });

  it('links a trimmed custom model id', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('openai', { apiKey: 'sk-test' }).subscribe(() => resolve()),
    );
    const link = vi.spyOn(repository, 'link');

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#provider-model-openai',
    ) as HTMLSelectElement;
    select.value = '__custom__';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '#provider-model-custom-openai',
    ) as HTMLInputElement;
    input.value = '  ';
    input.dispatchEvent(new Event('change'));
    expect(link).not.toHaveBeenCalled();

    input.value = '  custom-model-id  ';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(link).toHaveBeenCalledWith('openai', { model: 'custom-model-id' });
    expect(
      fixture.componentInstance['providersResource']
        .value()
        ?.find((row) => row.provider === 'openai')?.model,
    ).toBe('custom-model-id');
  });

  it('keeps the custom model input open when saving fails', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('openai', { apiKey: 'sk-test' }).subscribe(() => resolve()),
    );
    vi.spyOn(repository, 'link').mockReturnValue(throwError(() => new Error('nope')));

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#provider-model-openai',
    ) as HTMLSelectElement;
    select.value = '__custom__';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '#provider-model-custom-openai',
    ) as HTMLInputElement;
    const modelLabel = fixture.nativeElement
      .querySelector('label[for="provider-model-openai"]')
      ?.textContent?.trim();
    expect(modelLabel).toBeTruthy();
    expect(input.getAttribute('aria-label')).toBe(modelLabel);
    input.value = 'custom-model-id';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    const kept = fixture.nativeElement.querySelector(
      '#provider-model-custom-openai',
    ) as HTMLInputElement | null;
    expect(kept?.value).toBe('custom-model-id');
  });

  it('shows a reasoning effort select for a user-linked OpenAI provider', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('openai', { apiKey: 'sk-test' }).subscribe(() => resolve()),
    );

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#provider-effort-openai');
    expect(select).not.toBeNull();
    expect(select.value).toBe('high');
  });

  it('hides the reasoning effort select for Ollama', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('ollama', { baseUrl: 'http://ollama:11434' }).subscribe(() => resolve()),
    );

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#provider-effort-ollama')).toBeNull();
  });

  it('changing the effort select links the new value', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('openai', { apiKey: 'sk-test' }).subscribe(() => resolve()),
    );

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#provider-effort-openai');
    select.value = 'low';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    const updated = fixture.componentInstance['providersResource']
      .value()
      ?.find((row) => row.provider === 'openai');
    expect(updated?.reasoningEffort).toBe('low');
  });

  it('unlinks a provider after confirmation and reloads the list', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('anthropic', { apiKey: 'sk-test' }).subscribe(() => resolve()),
    );

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const confirmService = TestBed.inject(ConfirmService);
    const provider = fixture.componentInstance['providersResource']
      .value()
      ?.find((row) => row.provider === 'anthropic');
    const unlinkPromise = fixture.componentInstance['unlink'](provider!);
    confirmService.respond(true);
    await unlinkPromise;
    await fixture.whenStable();
    fixture.detectChanges();

    const updated = fixture.componentInstance['providersResource']
      .value()
      ?.find((row) => row.provider === 'anthropic');
    expect(updated?.configured).toBe(false);
  });
});
