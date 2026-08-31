export type AgentProviderId = 'anthropic' | 'openai' | 'ollama';
export type AgentAuthMode = 'api_key' | 'oauth' | 'none';
export type AgentCredentialSource = 'user' | 'env' | 'none';
export type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/** One row per provider on the Providers page - see docs/ai-agents.md for
 * the user-credential-over-.env-key precedence this reflects. */
export interface AgentProviderStatus {
  provider: AgentProviderId;
  configured: boolean;
  source: AgentCredentialSource;
  authMode?: AgentAuthMode;
  authModes: string[];
  accountLabel?: string;
  model: string;
  defaultModel: string;
  models: string[];
  reasoningEffort?: AgentReasoningEffort;
  reasoningEfforts: string[];
}

export interface AgentProviderLink {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  reasoningEffort?: AgentReasoningEffort;
}

export interface AgentOAuthStart {
  authorizeUrl: string;
  verifier: string;
  state: string;
}

export interface AgentProviderTestResult {
  ok: boolean;
  errorCode?: string;
}
