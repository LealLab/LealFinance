export type AgentConversationStatus = 'idle' | 'awaiting_confirmation';
export type AgentMessageRole = 'user' | 'assistant' | 'tool';

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentConversation {
  id: string;
  title: string | null;
  provider: string;
  model: string;
  status: AgentConversationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  toolCalls: AgentToolCall[] | null;
  toolCallId: string | null;
  toolName: string | null;
  isError: boolean;
  position: number;
  createdAt: string;
}

export interface AgentConversationDetail extends AgentConversation {
  messages: AgentMessage[];
}

export type AgentStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; ok: boolean }
  | { type: 'tool_confirm'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'refusal'; code: string }
  | { type: 'error'; code: string; params: Record<string, unknown> }
  | { type: 'done'; status: AgentConversationStatus; messageId: string | null };

export interface McpToken {
  token: string;
  expiresAt: string;
}
