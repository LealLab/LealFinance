import { firstValueFrom, toArray } from 'rxjs';
import { AgentStreamService, parseFrame } from './agent-stream.service';

function streamResponse(body: string, ok = true, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return {
    ok,
    status,
    body: ok ? stream : null,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

describe('AgentStreamService.stream', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits each parsed frame and completes on done', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamResponse(
        'event: delta\ndata: {"text":"He"}\n\n: heartbeat\n\nevent: delta\ndata: {"text":"llo"}\n\nevent: done\ndata: {"status":"idle","message_id":"m1"}\n\n',
      ),
    );
    const service = new AgentStreamService();

    const events = await firstValueFrom(service.stream('/agents/conversations/c1/messages', {}).pipe(toArray()));

    expect(events).toEqual([
      { type: 'delta', text: 'He' },
      { type: 'delta', text: 'llo' },
      { type: 'done', status: 'idle', messageId: 'm1' },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/agents/conversations/c1/messages',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('emits an error frame when the response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamResponse('{"error":{"code":"agents.chat_not_allowed","params":{}}}', false, 403),
    );
    const service = new AgentStreamService();

    const events = await firstValueFrom(service.stream('/x', {}).pipe(toArray()));

    expect(events).toEqual([{ type: 'error', code: 'agents.chat_not_allowed', params: {} }]);
  });

  it('emits a generic error frame when fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const service = new AgentStreamService();

    const events = await firstValueFrom(service.stream('/x', {}).pipe(toArray()));

    expect(events).toEqual([{ type: 'error', code: 'error.generic', params: {} }]);
  });
});

describe('parseFrame', () => {
  it('parses a delta frame', () => {
    expect(parseFrame('event: delta\ndata: {"text":"hi"}')).toEqual({ type: 'delta', text: 'hi' });
  });

  it('parses a tool_call frame with arguments', () => {
    expect(
      parseFrame('event: tool_call\ndata: {"id":"t1","name":"search","arguments":{"q":"x"}}'),
    ).toEqual({ type: 'tool_call', id: 't1', name: 'search', arguments: { q: 'x' } });
  });

  it('parses tool_result and tool_confirm frames', () => {
    expect(parseFrame('event: tool_result\ndata: {"id":"t1","name":"s","ok":true}')).toEqual({
      type: 'tool_result',
      id: 't1',
      name: 's',
      ok: true,
    });
    expect(
      parseFrame('event: tool_confirm\ndata: {"id":"w1","name":"create_transaction","arguments":{}}'),
    ).toEqual({ type: 'tool_confirm', id: 'w1', name: 'create_transaction', arguments: {} });
  });

  it('parses refusal and error frames', () => {
    expect(parseFrame('event: refusal\ndata: {"code":"agents.off_topic"}')).toEqual({
      type: 'refusal',
      code: 'agents.off_topic',
    });
    expect(parseFrame('event: error\ndata: {"code":"agents.provider_unavailable","params":{}}')).toEqual(
      { type: 'error', code: 'agents.provider_unavailable', params: {} },
    );
  });

  it('maps message_id to messageId on the done frame', () => {
    expect(parseFrame('event: done\ndata: {"status":"idle","message_id":"m9"}')).toEqual({
      type: 'done',
      status: 'idle',
      messageId: 'm9',
    });
    expect(parseFrame('event: done\ndata: {"status":"awaiting_confirmation"}')).toEqual({
      type: 'done',
      status: 'awaiting_confirmation',
      messageId: null,
    });
  });

  it('ignores comment lines and unknown or incomplete frames', () => {
    expect(parseFrame(': heartbeat')).toBeUndefined();
    expect(parseFrame('event: mystery\ndata: {}')).toBeUndefined();
    expect(parseFrame('event: delta')).toBeUndefined();
  });
});
