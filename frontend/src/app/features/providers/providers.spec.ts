import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { AgentProviderRepository } from '../../data/agent-provider.repository';
import { MockAgentProviderRepository } from '../../data/mock/mock-agent-provider.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { AgentProviderStatus } from '../../domain/models/agent-provider';
import { Providers } from './providers';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Providers', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Providers,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AgentProviderRepository, useClass: MockAgentProviderRepository },
      ],
    }).compileComponents();
  });

  it('renders every provider, unconfigured by default', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Provedores de IA');
    expect(text).toContain('Anthropic (Claude)');
    expect(text).toContain('OpenAI (Codex)');
    expect(text).toContain('Ollama');
    expect(text).toContain('Não configurado');
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
    expect(fixture.nativeElement.textContent).toContain('Vinculado');
  });

  it('sends a try-it chat message and renders the reply', async () => {
    const repository = TestBed.inject(AgentProviderRepository);
    await new Promise<void>((resolve) =>
      repository.link('anthropic', { apiKey: 'sk-test' }).subscribe(() => resolve()),
    );

    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component['chatInput'].set('Ola');
    component['sendChat']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['chatReply']()).toContain('Ola');
    expect(fixture.nativeElement.textContent).toContain('Mock reply to: Ola');
  });

  it('shows not-configured error when trying a provider with nothing linked', async () => {
    const fixture = TestBed.createComponent(Providers);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component['chatInput'].set('Ola');
    component['sendChat']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['chatErrorKey']()).toBe('providers.chatError');
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
      model: 'gpt-5.1',
      models: [],
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
    expect(fixture.nativeElement.textContent).toContain('Conectado');
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
