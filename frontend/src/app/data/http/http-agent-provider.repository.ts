import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { AgentProviderRepository } from '../agent-provider.repository';
import {
  AgentChatMessage,
  AgentChatReply,
  AgentOAuthStart,
  AgentProviderId,
  AgentProviderLink,
  AgentProviderStatus,
  AgentProviderTestResult,
} from '../../domain/models/agent-provider';
import { ApiClient } from '../../core/api-client';
import {
  mapAgentChatMessages,
  mapAgentChatReply,
  mapAgentOAuthStart,
  mapAgentProviderLink,
  mapAgentProviderStatus,
  mapAgentProviderTest,
} from './mappers';
import {
  AgentChatReplyWire,
  AgentChatRequestWire,
  AgentOAuthCompleteWire,
  AgentOAuthStartWire,
  AgentProviderLinkWire,
  AgentProviderStatusWire,
  AgentProviderTestWire,
} from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpAgentProviderRepository extends AgentProviderRepository {
  private readonly api = inject(ApiClient);

  list(): Observable<AgentProviderStatus[]> {
    return this.api
      .get<AgentProviderStatusWire[]>('/agents/providers')
      .pipe(map((rows) => rows.map(mapAgentProviderStatus)));
  }

  link(provider: AgentProviderId, input: AgentProviderLink): Observable<AgentProviderStatus> {
    return this.api
      .put<AgentProviderStatusWire>(
        `/agents/providers/${provider}`,
        mapAgentProviderLink(input) satisfies AgentProviderLinkWire,
      )
      .pipe(map(mapAgentProviderStatus));
  }

  unlink(provider: AgentProviderId): Observable<void> {
    return this.api.delete<void>(`/agents/providers/${provider}`);
  }

  startOAuth(provider: AgentProviderId): Observable<AgentOAuthStart> {
    return this.api
      .post<AgentOAuthStartWire>(`/agents/providers/${provider}/oauth/start`)
      .pipe(map(mapAgentOAuthStart));
  }

  completeOAuth(
    provider: AgentProviderId,
    input: { verifier: string; state: string; code: string },
  ): Observable<AgentProviderStatus> {
    return this.api
      .post<AgentProviderStatusWire>(
        `/agents/providers/${provider}/oauth/complete`,
        input satisfies AgentOAuthCompleteWire,
      )
      .pipe(map(mapAgentProviderStatus));
  }

  test(provider: AgentProviderId): Observable<AgentProviderTestResult> {
    return this.api
      .post<AgentProviderTestWire>(`/agents/providers/${provider}/test`)
      .pipe(map(mapAgentProviderTest));
  }

  chat(messages: AgentChatMessage[], provider?: AgentProviderId): Observable<AgentChatReply> {
    const body: AgentChatRequestWire = {
      messages: mapAgentChatMessages(messages),
      ...(provider ? { provider } : {}),
    };
    return this.api
      .post<AgentChatReplyWire>('/agents/chat', body)
      .pipe(map(mapAgentChatReply));
  }
}
