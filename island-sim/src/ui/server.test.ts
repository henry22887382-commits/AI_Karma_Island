import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessModelSecrets } from '../ai/model-settings.ts';
import {
  createAndStoreOpenRouterSlotKey,
  fetchCompatibleModels,
  fetchOpenRouterAccount,
  observerClientScript,
  ProcessOpenRouterManagement,
} from './server.ts';

test('observer client script including management-key actions remains syntactically valid', () => {
  assert.doesNotThrow(() => new Function(observerClientScript));
  assert.match(observerClientScript, /\/api\/settings\/openrouter\/management-key/);
  assert.match(observerClientScript, /\/api\/settings\/openrouter\/keys\/create/);
});

test('preserves a save name draft when a refresh replaces the input element', () => {
  const captureSource = observerClientScript.match(/function captureDrafts\(\) \{[\s\S]*?\n\}/)?.[0];
  const restoreSource = observerClientScript.match(/function restoreDrafts\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(captureSource, 'captureDrafts must be present in the observer client');
  assert.ok(restoreSource, 'restoreDrafts must be present in the observer client');

  let saveNameInput = { value: '55555' };
  const root = {
    querySelector(selector: string) {
      if (selector === '[data-save-name]') return saveNameInput;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const drafts = new Map();
  const captureDrafts = new Function('root', 'formDrafts', 'activeModelSlot', `${captureSource}; return captureDrafts;`)(root, drafts, 1);
  const restoreDrafts = new Function('root', 'formDrafts', 'activeModelSlot', 'loadedModelLists', 'applyLoadedModelList', `${restoreSource}; return restoreDrafts;`)(root, drafts, 1, new Map(), () => {});

  captureDrafts();
  saveNameInput = { value: '' };
  restoreDrafts();

  assert.equal(saveNameInput.value, '55555');
});

test('loads OpenAI-compatible model IDs server-side without exposing keys or inferring generic prices', async () => {
  let requestedUrl = '';
  let authorization = '';
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization') ?? '';
    return new Response(JSON.stringify({ data: [{ id: 'model-a', pricing: { prompt: '0.000001', completion: '0.000002' } }] }), { status: 200 });
  };
  const models = await fetchCompatibleModels('https://example.test/v1', 'secret-test-key', fetcher);
  assert.equal(requestedUrl, 'https://example.test/v1/models');
  assert.equal(authorization, 'Bearer secret-test-key');
  assert.deepEqual(models, [{ id: 'model-a', inputUsdPerMillion: null, outputUsdPerMillion: null }]);
  assert.doesNotMatch(JSON.stringify(models), /secret-test-key/);
});

test('uses OpenRouter model API pricing and never infers missing prices', async () => {
  const fetcher: typeof fetch = async (input) => {
    assert.equal(String(input), 'https://openrouter.ai/api/v1/models');
    return new Response(JSON.stringify({ data: [
      { id: 'open-model', pricing: { prompt: '0.000002', completion: '0.000004' } },
      { id: 'unknown-price', pricing: {} },
    ] }), { status: 200 });
  };
  const models = await fetchCompatibleModels('https://openrouter.ai/api/v1', 'ordinary-key', fetcher);
  assert.deepEqual(models, [
    { id: 'open-model', inputUsdPerMillion: 2, outputUsdPerMillion: 4 },
    { id: 'unknown-price', inputUsdPerMillion: null, outputUsdPerMillion: null },
  ]);
});

test('queries real OpenRouter credits and per-key usage with the Management key only', async () => {
  const requests: { url: string; authorization: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('authorization') ?? '';
    requests.push({ url, authorization });
    if (url.endsWith('/credits')) return new Response(JSON.stringify({ data: { total_credits: 25, total_usage: 4.5 } }), { status: 200 });
    return new Response(JSON.stringify({ data: [
      { hash: 'hash-safe', name: 'resident 1', usage: 1.25, disabled: false },
      { hash: 'hash-no-usage', name: 'resident 2', disabled: false },
    ] }), { status: 200 });
  };
  const account = await fetchOpenRouterAccount('management-secret', fetcher);
  assert.deepEqual(account, {
    credits: { totalCredits: 25, totalUsage: 4.5 },
    keys: [
      { hash: 'hash-safe', name: 'resident 1', usage: 1.25, disabled: false },
      { hash: 'hash-no-usage', name: 'resident 2', usage: null, disabled: false },
    ],
  });
  assert.deepEqual(requests, [
    { url: 'https://openrouter.ai/api/v1/credits', authorization: 'Bearer management-secret' },
    { url: 'https://openrouter.ai/api/v1/keys', authorization: 'Bearer management-secret' },
  ]);
  assert.doesNotMatch(JSON.stringify(account), /management-secret/);

  await assert.rejects(fetchOpenRouterAccount('ordinary-key', async () => new Response('', { status: 403 })), /Management key/);
});

test('creates one slot inference key on explicit management call and stores plaintext only in process memory', async () => {
  let requestedUrl = '';
  let authorization = '';
  let requestBody = '';
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization') ?? '';
    requestBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ key: 'sk-or-v1-one-time-secret', data: { hash: 'hash-slot-1', name: 'IslandSim resident slot 1' } }), { status: 200 });
  };
  const secrets = new ProcessModelSecrets();
  const management = new ProcessOpenRouterManagement();
  management.setKey('management-secret');
  const result = await createAndStoreOpenRouterSlotKey(1, 'credential-slot-1', 'management-secret', secrets, management, fetcher);
  assert.equal(requestedUrl, 'https://openrouter.ai/api/v1/keys');
  assert.equal(authorization, 'Bearer management-secret');
  assert.deepEqual(JSON.parse(requestBody), { name: 'IslandSim resident slot 1' });
  assert.deepEqual(result, { created: true, slotId: 1, keyConfigured: true, name: 'IslandSim resident slot 1', hash: 'hash-slot-1' });
  assert.doesNotMatch(JSON.stringify(result), /one-time-secret|management-secret/);
  assert.equal(secrets.getForCredential('credential-slot-1'), 'sk-or-v1-one-time-secret');
  assert.equal(secrets.getForCredential('other-slot'), undefined);
  assert.equal(management.getKey(), 'management-secret');
  assert.equal(management.getSlotKeyHash(1), 'hash-slot-1');
  await assert.rejects(createAndStoreOpenRouterSlotKey(1, 'credential-slot-1', 'management-secret', secrets, management, fetcher), /避免重複/);
});

test('rejects insecure remote model endpoints and reports upstream errors without retrying credentials elsewhere', async () => {
  await assert.rejects(fetchCompatibleModels('http://models.example.test/v1', 'secret'), /必須使用 HTTPS/);
  await assert.rejects(fetchCompatibleModels('https://models.example.test/v1', 'secret', async () => new Response('', { status: 401 })), /HTTP 401/);
});
