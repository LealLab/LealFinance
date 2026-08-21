import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { AgentProviderRepository } from '../../data/agent-provider.repository';
import { MockAgentProviderRepository } from '../../data/mock/mock-agent-provider.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { AgentProviderStatus } from '../../domain/models/agent-provider';
import { ProviderLinkModal } from './provider-link-modal';
import ptBR from '../../../../public/i18n/pt-BR.json';

const ANTHROPIC_STATUS: AgentProviderStatus = {
  provider: 'anthropic',
  configured: false,
  source: 'none',
  authModes: ['api_key', 'oauth'],
  model: 'claude-sonnet-5',
  defaultModel: 'claude-sonnet-5',
  models: [],
};

const OPENAI_STATUS: AgentProviderStatus = {
  provider: 'openai',
  configured: false,
  source: 'none',
  authModes: ['api_key', 'oauth'],
  model: 'gpt-5.1',
  defaultModel: 'gpt-5.1',
  models: [],
};

const OLLAMA_STATUS: AgentProviderStatus = {
  provider: 'ollama',
  configured: false,
  source: 'none',
  authModes: ['none'],
  model: 'llama3.1',
  defaultModel: 'llama3.1',
  models: [],
};

describe('ProviderLinkModal', () => {
  beforeEach(async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    await TestBed.configureTestingModule({
      imports: [
        ProviderLinkModal,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AgentProviderRepository, useClass: MockAgentProviderRepository },
      ],
    }).compileComponents();
  });

  it('links via api key and emits the updated status', async () => {
    const fixture = TestBed.createComponent(ProviderLinkModal);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('provider', ANTHROPIC_STATUS);
    let emitted: AgentProviderStatus | undefined;
    fixture.componentInstance.linked.subscribe((status) => (emitted = status));
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component['apiKeyForm'].controls.apiKey.setValue('sk-test');
    component['submitApiKey']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(emitted).toMatchObject({ provider: 'anthropic', configured: true, source: 'user' });
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('rejects an empty api key without calling the repository', async () => {
    const fixture = TestBed.createComponent(ProviderLinkModal);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('provider', ANTHROPIC_STATUS);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component['submitApiKey']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['apiKeyForm'].invalid).toBe(true);
    expect(fixture.componentInstance.open()).toBe(true);
  });

  it('links Ollama with a base URL instead of an api key', async () => {
    const fixture = TestBed.createComponent(ProviderLinkModal);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('provider', OLLAMA_STATUS);
    let emitted: AgentProviderStatus | undefined;
    fixture.componentInstance.linked.subscribe((status) => (emitted = status));
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    expect(component['isOllama']()).toBe(true);
    component['apiKeyForm'].controls.baseUrl.setValue('http://ollama:11434');
    component['submitApiKey']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(emitted).toMatchObject({ provider: 'ollama', configured: true, authMode: 'none' });
  });

  it('walks the OAuth start-then-paste flow to completion', async () => {
    const fixture = TestBed.createComponent(ProviderLinkModal);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('provider', ANTHROPIC_STATUS);
    let emitted: AgentProviderStatus | undefined;
    fixture.componentInstance.linked.subscribe((status) => (emitted = status));
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component['setMode']('oauth');
    expect(component['mode']()).toBe('oauth');

    component['startOAuth']();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component['oauthStep']()).toBe('paste');
    expect(window.open).toHaveBeenCalled();

    component['oauthCode'].set('some-code#some-state');
    component['completeOAuth']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(emitted).toMatchObject({ provider: 'anthropic', configured: true, authMode: 'oauth' });
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('shows OpenAI-specific paste guidance since its redirect page always fails to load', async () => {
    const fixture = TestBed.createComponent(ProviderLinkModal);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('provider', OPENAI_STATUS);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['pasteHintKey']()).toBe('providers.form.oauth.pasteHintOpenai');
  });

  it('uses the plain paste guidance for Anthropic', async () => {
    const fixture = TestBed.createComponent(ProviderLinkModal);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('provider', ANTHROPIC_STATUS);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['pasteHintKey']()).toBe('providers.form.oauth.pasteHint');
  });
});
