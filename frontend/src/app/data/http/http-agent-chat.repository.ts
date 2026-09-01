import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { AgentStreamService } from '../../core/agent-stream.service';
import { ApiClient } from '../../core/api-client';
import {
  AgentConversation,
  AgentConversationDetail,
  AgentMessage,
  AgentStreamEvent,
  AgentToolCall,
  McpToken,
} from '../../domain/models/agent-chat';
import { AgentChatRepository } from '../agent-chat.repository';

interface ConversationWire {
  id: string;
  title: string | null;
  provider: string;
  model: string;
  status: AgentConversation['status'];
  created_at: string;
  updated_at: string;
}
type ToolCallWire = AgentToolCall;
interface MessageWire {
  id: string;
  role: AgentMessage['role'];
  content: string;
  tool_calls: ToolCallWire[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  is_error: boolean;
  position: number;
  created_at: string;
}
interface ConversationDetailWire extends ConversationWire {
  messages: MessageWire[];
}
interface McpTokenWire {
  token: string;
  expires_at: string;
}

const mapConversation = (value: ConversationWire): AgentConversation => ({
  id: value.id,
  title: value.title,
  provider: value.provider,
  model: value.model,
  status: value.status,
  createdAt: value.created_at,
  updatedAt: value.updated_at,
});
const mapMessage = (value: MessageWire): AgentMessage => ({
  id: value.id,
  role: value.role,
  content: value.content,
  toolCalls: value.tool_calls,
  toolCallId: value.tool_call_id,
  toolName: value.tool_name,
  isError: value.is_error,
  position: value.position,
  createdAt: value.created_at,
});
const mapDetail = (value: ConversationDetailWire): AgentConversationDetail => ({
  ...mapConversation(value),
  messages: value.messages.map(mapMessage),
});

/** The viewer's local calendar day (YYYY-MM-DD), sent so the assistant's
 * "today" matches the user's timezone rather than the server's UTC. */
const localDate = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

@Injectable({ providedIn: 'root' })
export class HttpAgentChatRepository extends AgentChatRepository {
  private readonly api = inject(ApiClient);
  private readonly stream = inject(AgentStreamService);

  listConversations(): Observable<AgentConversation[]> {
    return this.api
      .get<ConversationWire[]>('/agents/conversations')
      .pipe(map((rows) => rows.map(mapConversation)));
  }
  createConversation(provider?: string): Observable<AgentConversation> {
    return this.api
      .post<ConversationWire>('/agents/conversations', provider ? { provider } : {})
      .pipe(map(mapConversation));
  }
  getConversation(id: string): Observable<AgentConversationDetail> {
    return this.api.get<ConversationDetailWire>(`/agents/conversations/${id}`).pipe(map(mapDetail));
  }
  deleteConversation(id: string): Observable<void> {
    return this.api.delete<void>(`/agents/conversations/${id}`);
  }
  sendMessage(id: string, content: string): Observable<AgentStreamEvent> {
    return this.stream.stream(`/agents/conversations/${id}/messages`, {
      content,
      client_date: localDate(),
    });
  }
  confirm(
    id: string,
    toolCallId: string,
    approved: boolean,
    args?: Record<string, unknown>,
  ): Observable<AgentStreamEvent> {
    return this.stream.stream(`/agents/conversations/${id}/confirm`, {
      tool_call_id: toolCallId,
      approved,
      client_date: localDate(),
      ...(args ? { arguments: args } : {}),
    });
  }
  mintMcpToken(): Observable<McpToken> {
    return this.api
      .post<McpTokenWire>('/agents/mcp-token')
      .pipe(map((value) => ({ token: value.token, expiresAt: value.expires_at })));
  }
}
