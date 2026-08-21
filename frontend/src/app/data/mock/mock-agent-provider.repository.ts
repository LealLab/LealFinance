import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AgentProviderRepository } from '../agent-provider.repository';
import {
  AgentChatMessage,
  AgentChatReply,
  AgentOAuthStart,
  AgentProviderId,
  AgentProviderLink,
  AgentProviderStatus,
  AgentProviderTestResult,
  AgentReasoningEffort,
} from '../../domain/models/agent-provider';
import { ApiError } from '../../core/api-error';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';

const REASONING_EFFORTS: AgentReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

interface ModelSpec {
  id: string;
  defaultEffort?: AgentReasoningEffort;
}

interface ProviderSpec {
  authModes: string[];
  defaultModel: string;
  models: ModelSpec[];
  reasoningEfforts: AgentReasoningEffort[];
}

const PROVIDER_SPECS: Record<AgentProviderId, ProviderSpec> = {
  anthropic: {
    authModes: ['api_key', 'oauth'],
    defaultModel: 'claude-sonnet-5',
    models: [
      { id: 'claude-opus-5' },
      { id: 'claude-sonnet-5' },
      { id: 'claude-haiku-4-5-20251001' },
    ],
    reasoningEfforts: REASONING_EFFORTS,
  },
  openai: {
    authModes: ['api_key', 'oauth'],
    defaultModel: 'gpt-5.6-luna',
    models: [
      { id: 'gpt-5.6-luna', defaultEffort: 'high' },
      { id: 'gpt-5.6-sol', defaultEffort: 'medium' },
      { id: 'gpt-5.6-terra', defaultEffort: 'medium' },
      { id: 'gpt-5.5', defaultEffort: 'medium' },
    ],
    reasoningEfforts: REASONING_EFFORTS,
  },
  ollama: { authModes: ['none'], defaultModel: 'llama3.1', models: [], reasoningEfforts: [] },
};

function defaultEffort(provider: AgentProviderId, model: string): AgentReasoningEffort | undefined {
  return PROVIDER_SPECS[provider].models.find((m) => m.id === model)?.defaultEffort;
}

interface LinkedRow {
  authMode: string;
  accountLabel?: string;
  model: string;
  reasoningEffort?: AgentReasoningEffort;
}

/** Not wired into the running app - a test double for unit tests only, see
 * CLAUDE.md. Linked state lives locally rather than in MockStore since the
 * agents domain doesn't interact with any other mocked entity. */
@Injectable({ providedIn: 'root' })
export class MockAgentProviderRepository extends AgentProviderRepository {
  private readonly latencyMs = inject(MOCK_LATENCY_MS);
  private readonly linked = new Map<AgentProviderId, LinkedRow>();

  list(): Observable<AgentProviderStatus[]> {
    return mockResult(
      () =>
        (Object.keys(PROVIDER_SPECS) as AgentProviderId[]).map((provider) =>
          this.statusFor(provider),
        ),
      this.latencyMs,
    );
  }

  link(provider: AgentProviderId, input: AgentProviderLink): Observable<AgentProviderStatus> {
    return mockResult(() => {
      const existing = this.linked.get(provider);
      if (existing && input.apiKey === undefined && input.baseUrl === undefined) {
        // Model/effort-only update: keeps auth_mode/accountLabel, matching
        // the backend's link_api_key model-only branch. Switching model
        // resets effort to that model's own default unless this same call
        // also names one explicitly.
        const model = input.model ?? existing.model;
        const reasoningEffort =
          input.model !== undefined && input.model !== existing.model
            ? (input.reasoningEffort ?? defaultEffort(provider, model))
            : (input.reasoningEffort ?? existing.reasoningEffort);
        this.linked.set(provider, { ...existing, model, reasoningEffort });
        return this.statusFor(provider);
      }
      if (provider === 'ollama') {
        if (!input.baseUrl) throw new ApiError(422, 'agents.base_url_required', {});
        const model = input.model ?? this.defaultModel(provider);
        this.linked.set(provider, { authMode: 'none', model });
      } else {
        if (!input.apiKey) throw new ApiError(422, 'agents.api_key_required', {});
        const model = input.model ?? this.defaultModel(provider);
        this.linked.set(provider, {
          authMode: 'api_key',
          model,
          reasoningEffort: input.reasoningEffort ?? defaultEffort(provider, model),
        });
      }
      return this.statusFor(provider);
    }, this.latencyMs);
  }

  unlink(provider: AgentProviderId): Observable<void> {
    return mockResult(() => {
      if (!this.linked.has(provider)) {
        throw new ApiError(404, 'agent_credential.not_found', {});
      }
      this.linked.delete(provider);
    }, this.latencyMs);
  }

  startOAuth(provider: AgentProviderId): Observable<AgentOAuthStart> {
    return mockResult(
      () => ({
        authorizeUrl: `https://example.invalid/oauth/${provider}`,
        verifier: 'mock-verifier',
        state: 'mock-state',
      }),
      this.latencyMs,
    );
  }

  completeOAuth(provider: AgentProviderId): Observable<AgentProviderStatus> {
    return mockResult(() => {
      const model = this.defaultModel(provider);
      this.linked.set(provider, {
        authMode: 'oauth',
        accountLabel: 'Mock subscription',
        model,
        reasoningEffort: defaultEffort(provider, model),
      });
      return this.statusFor(provider);
    }, this.latencyMs);
  }

  test(provider: AgentProviderId): Observable<AgentProviderTestResult> {
    return mockResult(
      () =>
        this.linked.has(provider)
          ? { ok: true, errorCode: undefined }
          : { ok: false, errorCode: 'agents.not_configured' },
      this.latencyMs,
    );
  }

  chat(messages: AgentChatMessage[], provider?: AgentProviderId): Observable<AgentChatReply> {
    return mockResult(() => {
      const target = provider ?? (Object.keys(PROVIDER_SPECS) as AgentProviderId[])[0];
      if (!this.linked.has(target)) throw new ApiError(422, 'agents.not_configured', {});
      const lastMessage = messages.at(-1)?.content ?? '';
      return {
        provider: target,
        model: this.linked.get(target)?.model ?? this.defaultModel(target),
        reply: `Mock reply to: ${lastMessage}`,
      };
    }, this.latencyMs);
  }

  private defaultModel(provider: AgentProviderId): string {
    return PROVIDER_SPECS[provider].defaultModel;
  }

  private statusFor(provider: AgentProviderId): AgentProviderStatus {
    const spec = PROVIDER_SPECS[provider];
    const row = this.linked.get(provider);
    return {
      provider,
      configured: row !== undefined,
      source: row ? 'user' : 'none',
      authMode: row?.authMode as AgentProviderStatus['authMode'],
      authModes: spec.authModes,
      accountLabel: row?.accountLabel,
      model: row?.model ?? spec.defaultModel,
      defaultModel: spec.defaultModel,
      models: spec.models.map((m) => m.id),
      reasoningEffort: row?.reasoningEffort,
      reasoningEfforts: spec.reasoningEfforts,
    };
  }
}
