import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { HttpChatCompletionsProvider } from './http-provider.ts';

test('sends an OpenAI-compatible request to localhost and returns text plus token usage', async () => {
  const secret = 'local-contract-key';
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const parsed = JSON.parse(body) as { model: string; max_completion_tokens: number; messages: readonly { content: string }[] };
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    assert.equal(parsed.model, 'contract-model');
    assert.equal(parsed.max_completion_tokens, 12);
    assert.match(parsed.messages[0]?.content ?? '', /只在本機測試/);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '{"action_id":"wait","intent":"等待"}' } }], usage: { prompt_tokens: 9, completion_tokens: 4 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const provider = new HttpChatCompletionsProvider({
      id: 'local-contract', baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'contract-model', apiKey: secret, maxOutputTokens: 32,
    });
    const completion = await provider.complete('只在本機測試', 12);
    assert.equal(completion.raw, '{"action_id":"wait","intent":"等待"}');
    assert.deepEqual(completion.usage, { inputTokens: 9, outputTokens: 4 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('does not include a key or a provider error body in thrown error text', async () => {
  const secret = 'never-echo-this-key';
  const server = createServer((_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `invalid ${secret}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const provider = new HttpChatCompletionsProvider({
      id: 'local-reject', baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'contract-model', apiKey: secret, maxOutputTokens: 32,
    });
    await assert.rejects(provider.complete('local test', 12), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
