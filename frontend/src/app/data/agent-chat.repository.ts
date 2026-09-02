import { Observable } from 'rxjs';
import {
  AgentConversation,
  AgentConversationDetail,
  AgentStreamEvent,
  McpToken,
} from '../domain/models/agent-chat';

export abstract class AgentChatRepository {
  abstract listConversations(): Observable<AgentConversation[]>;
  abstract createConversation(provider?: string): Observable<AgentConversation>;
  abstract getConversation(id: string): Observable<AgentConversationDetail>;
  abstract deleteConversation(id: string): Observable<void>;
  abstract sendMessage(id: string, content: string): Observable<AgentStreamEvent>;
  abstract confirm(
    id: string,
    toolCallId: string,
    approved: boolean,
    args?: Record<string, unknown>,
  ): Observable<AgentStreamEvent>;
  abstract mintMcpToken(): Observable<McpToken>;
  abstract getInstructions(): Observable<string>;
  /** Rejected text is refused by the backend and never stored. */
  abstract saveInstructions(instructions: string): Observable<string>;
}
