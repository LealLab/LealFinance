import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AgentConversationStatus, AgentStreamEvent } from '../domain/models/agent-chat';

const cookieValue = (name: string): string => {
  const item = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Parse one `event:`/`data:` SSE block into a typed event. Exported for unit
 * tests; comment (`:`) lines are ignored and an unknown event name yields
 * undefined. */
export const parseFrame = (block: string): AgentStreamEvent | undefined => {
  let event = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!event || !data) return undefined;
  const value = record(JSON.parse(data));
  switch (event) {
    case 'delta':
      return { type: 'delta', text: String(value['text'] ?? '') };
    case 'tool_call':
      return {
        type: 'tool_call',
        id: String(value['id']),
        name: String(value['name']),
        arguments: record(value['arguments']),
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        id: String(value['id']),
        name: String(value['name']),
        ok: value['ok'] === true,
      };
    case 'tool_confirm':
      return {
        type: 'tool_confirm',
        id: String(value['id']),
        name: String(value['name']),
        arguments: record(value['arguments']),
      };
    case 'refusal':
      return { type: 'refusal', code: String(value['code'] ?? '') };
    case 'error':
      return {
        type: 'error',
        code: String(value['code'] ?? 'error.generic'),
        params: record(value['params']),
      };
    case 'done':
      return {
        type: 'done',
        status: value['status'] as AgentConversationStatus,
        messageId: (value['message_id'] as string | null | undefined) ?? null,
      };
    default:
      return undefined;
  }
};

@Injectable({ providedIn: 'root' })
export class AgentStreamService {
  /** ApiClient cannot express a streaming response; this is the one direct HTTP path. */
  stream(path: string, body: unknown): Observable<AgentStreamEvent> {
    return new Observable<AgentStreamEvent>((subscriber) => {
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let cancelled = false;

      void (async () => {
        const response = await fetch(`/api/v1${path}`, {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-XSRF-TOKEN': cookieValue('XSRF-TOKEN'),
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const value = record(await response.json().catch(() => undefined));
          const error = record(value['error']);
          subscriber.next({
            type: 'error',
            code: String(error['code'] ?? 'error.generic'),
            params: record(error['params']),
          });
          subscriber.complete();
          return;
        }
        if (!response.body) {
          subscriber.next({ type: 'error', code: 'error.generic', params: {} });
          subscriber.complete();
          return;
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!cancelled) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            const event = parseFrame(block);
            if (!event) continue;
            subscriber.next(event);
            if (event.type === 'done' || event.type === 'error') {
              subscriber.complete();
              return;
            }
          }
        }
        buffer += decoder.decode();
        const event = parseFrame(buffer);
        if (event) subscriber.next(event);
        subscriber.complete();
      })().catch(() => {
        if (!subscriber.closed) {
          subscriber.next({ type: 'error', code: 'error.generic', params: {} });
          subscriber.complete();
        }
      });

      return () => {
        cancelled = true;
        controller.abort();
        void reader?.cancel().catch(() => undefined);
      };
    });
  }
}
