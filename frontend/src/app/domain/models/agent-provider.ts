export type AgentProviderId = 'anthropic' | 'openai' | 'ollama';
export type AgentAuthMode = 'api_key' | 'oauth' | 'none';
export type AgentCredentialSource = 'user' | 'env' | 'none';

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
}

export interface AgentProviderLink {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
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

export type AgentChatRole = 'user' | 'assistant';

export interface AgentChatMessage {
  role: AgentChatRole;
  content: string;
}

export interface AgentChatReply {
  provider: AgentProviderId;
  model: string;
  reply: string;
}
