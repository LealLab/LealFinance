import { Injectable, inject } from '@angular/core';
import { Observable, from, mergeMap, of } from 'rxjs';
import {
  AgentChatRepository,
  ImportSuggestion,
  ImportSuggestItem,
} from '../agent-chat.repository';
import {
  AgentConversation,
  AgentConversationDetail,
  AgentMessage,
  AgentStreamEvent,
  McpToken,
} from '../../domain/models/agent-chat';
import { ApiError } from '../../core/api-error';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';

/** Test double only. It is intentionally local and has no backend behavior. */
@Injectable({ providedIn: 'root' })
export class MockAgentChatRepository extends AgentChatRepository {
  private readonly latencyMs = inject(MOCK_LATENCY_MS);
  private readonly rows = new Map<
    string,
    { conversation: AgentConversation; messages: AgentMessage[] }
  >();
  private nextId = 1;
  private instructions = '';

  listConversations(): Observable<AgentConversation[]> {
    return mockResult(
      () => [...this.rows.values()].map(({ conversation }) => conversation),
      this.latencyMs,
    );
  }
  createConversation(provider?: string): Observable<AgentConversation> {
    return mockResult(() => {
      const now = new Date().toISOString();
      const conversation: AgentConversation = {
        id: `c${this.nextId++}`,
        title: null,
        provider: provider ?? 'mock',
        model: 'mock-model',
        status: 'idle',
        pendingCallId: null,
        createdAt: now,
        updatedAt: now,
      };
      this.rows.set(conversation.id, { conversation, messages: [] });
      return conversation;
    }, this.latencyMs);
  }
  getConversation(id: string): Observable<AgentConversationDetail> {
    return mockResult(() => {
      const row = this.rows.get(id);
      if (!row) throw new Error('conversation not found');
      return { ...row.conversation, messages: [...row.messages] };
    }, this.latencyMs);
  }
  deleteConversation(id: string): Observable<void> {
    return mockResult(() => {
      this.rows.delete(id);
    }, this.latencyMs);
  }
  sendMessage(id: string, content: string): Observable<AgentStreamEvent> {
    return this.events(
      id,
      [
        { type: 'delta', text: 'Mock: ' },
        { type: 'delta', text: content },
        { type: 'done', status: 'idle', messageId: 'm' },
      ],
      content,
    );
  }
  confirm(id: string, toolCallId: string, approved: boolean): Observable<AgentStreamEvent> {
    return this.events(
      id,
      [
        { type: 'delta', text: approved ? 'Mock: confirmed' : 'Mock: rejected' },
        { type: 'done', status: 'idle', messageId: toolCallId },
      ],
      approved ? 'Mock: confirmed' : 'Mock: rejected',
      false,
    );
  }
  getInstructions(): Observable<string> {
    return mockResult(() => this.instructions, this.latencyMs);
  }
  saveInstructions(instructions: string): Observable<string> {
    return mockResult(() => {
      const cleaned = instructions.trim();
      // Stands in for the backend's classifier so the rejected path is testable.
      if (cleaned.length > 0 && !/budget|spend|account|transaction|currency|finance/i.test(cleaned))
        throw new ApiError(422, 'agents.instructions_rejected', {
          reason: 'This is not about your finances.',
        });
      this.instructions = cleaned;
      return cleaned;
    }, this.latencyMs);
  }
  suggestImportCategories(items: readonly ImportSuggestItem[]): Observable<ImportSuggestion[]> {
    void items;
    return of([]);
  }
  mintMcpToken(): Observable<McpToken> {
    return mockResult(
      () => ({
        token: 'mock-mcp-token',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
      this.latencyMs,
    );
  }

  private events(
    id: string,
    events: AgentStreamEvent[],
    assistantText: string,
    addUser = true,
  ): Observable<AgentStreamEvent> {
    return mockResult(() => {
      const row = this.rows.get(id);
      if (row) {
        const now = new Date().toISOString();
        if (addUser)
          row.messages.push({
            id: `m${this.nextId++}`,
            role: 'user',
            content: assistantText,
            toolCalls: null,
            toolCallId: null,
            toolName: null,
            isError: false,
            position: row.messages.length,
            createdAt: now,
          });
        row.messages.push({
          id: `m${this.nextId++}`,
          role: 'assistant',
          content: assistantText,
          toolCalls: null,
          toolCallId: null,
          toolName: null,
          isError: false,
          position: row.messages.length,
          createdAt: now,
        });
        row.conversation = { ...row.conversation, status: 'idle', updatedAt: now };
      }
      return events;
    }, this.latencyMs).pipe(mergeMap((items) => from(items)));
  }
}
