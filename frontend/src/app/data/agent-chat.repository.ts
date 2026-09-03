import { Observable } from 'rxjs';
import {
  AgentConversation,
  AgentConversationDetail,
  AgentStreamEvent,
  McpToken,
} from '../domain/models/agent-chat';

/** One import row handed to the categorizer - `index` ties the answer back
 * to the grid row (see backend/app/schemas/agent.py::ImportSuggestItem). */
export interface ImportSuggestItem {
  index: number;
  description: string;
  type: 'income' | 'expense';
}

/** The categorizer's answer for one row: either `categoryId` names an
 * existing category to assign, or `groupName` + `categoryName` propose a new
 * one for the user to create. `groupId` is set when the proposed category
 * joins an existing group. */
export interface ImportSuggestion {
  index: number;
  categoryId?: string;
  groupId?: string;
  groupName?: string;
  categoryName?: string;
}

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
  /** One-shot AI categorization for the transaction import page. Nothing is
   * written - the caller applies or discards each suggestion. */
  abstract suggestImportCategories(
    items: readonly ImportSuggestItem[],
  ): Observable<ImportSuggestion[]>;
  abstract getInstructions(): Observable<string>;
  /** Rejected text is refused by the backend and never stored. */
  abstract saveInstructions(instructions: string): Observable<string>;
}
