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
import { Providers } from './providers';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Providers', () => {
  let agentChatRepo: { mintMcpToken: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    agentChatRepo = {
      mintMcpToken: vi
        .fn()
        .mockReturnValue(of({ token: 'mcp-secret', expiresAt: '2026-09-01T00:00:00Z' })),
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
    expect(
      (fixture.nativeElement.querySelector('#providers-mcp-token') as HTMLInputElement).value,
    ).toBe('mcp-secret');
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
