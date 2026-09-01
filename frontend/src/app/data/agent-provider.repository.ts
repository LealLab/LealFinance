import { Observable } from 'rxjs';
import {
  AgentOAuthStart,
  AgentProviderId,
  AgentProviderLink,
  AgentProviderStatus,
  AgentProviderTestResult,
} from '../domain/models/agent-provider';

export abstract class AgentProviderRepository {
  abstract list(): Observable<AgentProviderStatus[]>;
  abstract link(provider: AgentProviderId, input: AgentProviderLink): Observable<AgentProviderStatus>;
  abstract unlink(provider: AgentProviderId): Observable<void>;
  abstract startOAuth(provider: AgentProviderId): Observable<AgentOAuthStart>;
  abstract completeOAuth(
    provider: AgentProviderId,
    input: { verifier: string; state: string; code: string },
  ): Observable<AgentProviderStatus>;
  abstract test(provider: AgentProviderId): Observable<AgentProviderTestResult>;
}
