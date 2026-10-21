import test from 'node:test';
import assert from 'node:assert/strict';
import { loadIslandGraph } from '../content/island.ts';
import { createInitialWorld } from '../engine/world.ts';
import { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { ModelSettingsStore, ProcessModelSecrets } from '../ai/model-settings.ts';
import { SQLiteObserverPort } from './observer-adapter.ts';
import { createObserverServer } from './server.ts';

const sourceTables = new URL('../../references/tables/', import.meta.url);

test('projects actual persisted source graph and all ten residents without inventing placements or models', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const world = createInitialWorld(graph, { seed: 'observer-adapter-test', contentVersion: 'test-source' });
  const store = SQLiteWorldStore.open(':memory:');
  store.commit(0, world, []);
  const port = new SQLiteObserverPort(store, { speedOptions: [], sourceGraph: graph });
  const snapshot = await port.readSnapshot();
  assert.equal(snapshot.initialized, true);
  assert.equal(snapshot.map.nodes.length, graph.nodes.length);
  assert.equal(snapshot.residents.length, 10);
  assert.ok(snapshot.map.nodes.some((node) => node.regionDescription !== '來源未提供區域描述'));
  for (const sourceNode of graph.nodes) {
    const projected = snapshot.map.nodes.find((node) => node.id === sourceNode.id);
    assert.ok(projected);
    assert.equal(projected.x, sourceNode.approximateImagePosition.x);
    assert.equal(projected.y, sourceNode.approximateImagePosition.y);
  }
  assert.ok(snapshot.residents.every((resident) => ['1', '8', '13'].includes(resident.nodeId ?? '') && resident.model === null));
  assert.ok(snapshot.unresolved?.some((item) => item.includes('D-012')));
  store.close();
});

test('returns an explicit empty-database state instead of sample residents', async () => {
  const store = SQLiteWorldStore.open(':memory:');
  const snapshot = await new SQLiteObserverPort(store).readSnapshot();
  assert.equal(snapshot.initialized, false);
  assert.equal(snapshot.residents.length, 0);
  store.close();
});

test('serves the observer page, real snapshot API and strict runtime-only controls over localhost HTTP', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const world = createInitialWorld(graph, { seed: 'observer-http-test', contentVersion: 'test-source' });
  const store = SQLiteWorldStore.open(':memory:');
  store.commit(0, world, []);
  const server = createObserverServer(store, { speedOptions: [], sourceGraph: graph });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /輪迴島觀察台/);
    const response = await fetch(`${baseUrl}/api/observer`);
    const result = await response.json() as { markup: string };
    assert.match(result.markup, /島民 resident-01/);
    assert.match(result.markup, /尚待設定/);
    assert.match(result.markup, /data-control="resume" disabled>恢復/);
    const rejected = await fetch(`${baseUrl}/api/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'set-speed', value: 99 }) });
    assert.equal(rejected.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});

test('saves model settings over HTTP while keeping the API key out of persistence and every response', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const world = createInitialWorld(graph, { seed: 'observer-settings-test', contentVersion: 'test-source' });
  const store = SQLiteWorldStore.open(':memory:');
  const settings = new ModelSettingsStore(new (await import('node:sqlite')).DatabaseSync(':memory:'));
  const secrets = new ProcessModelSecrets();
  store.commit(0, world, []);
  const server = createObserverServer(store, { speedOptions: [], sourceGraph: graph }, settings, secrets);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const secret = 'test-only-secret-should-never-be-returned';
  try {
    const saved = await fetch(`${baseUrl}/api/settings/slot`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: 1, provider: 'Local test provider', baseUrl: 'http://127.0.0.1:9999/v1', model: 'test-model', modelSizeB: '8',
        sizeAtLeast8BConfirmed: true, styleDescription: '測試用謹慎風格',
        apiKey: secret, inputUsdPerMillion: '0', outputUsdPerMillion: '0', maxInputTokens: '1000', maxOutputTokens: '200',
        fallbackModels: 'test-fallback',
      }),
    });
    const savedBody = await saved.text();
    assert.equal(saved.status, 200);
    assert.doesNotMatch(savedBody, new RegExp(secret));
    assert.deepEqual(settings.readSlots()[0], {
      slotId: 1, provider: 'Local test provider', baseUrl: 'http://127.0.0.1:9999/v1', model: 'test-model',
      fallbackModels: ['test-fallback'], inputUsdPerMillion: 0, outputUsdPerMillion: 0,
      maxInputTokens: 1000, maxOutputTokens: 200, modelSizeB: 8, sizeAtLeast8BConfirmed: true, styleDescription: '測試用謹慎風格', updatedAt: settings.readSlots()[0]?.updatedAt,
      credentialRef: settings.readSlots()[0]?.credentialRef,
    });
    const credentialRef = settings.readSlots()[0]?.credentialRef;
    assert.ok(credentialRef);
    assert.equal(secrets.getForCredential(credentialRef), secret);
    const readback = await fetch(`${baseUrl}/api/observer`);
    const readbackBody = await readback.text();
    assert.doesNotMatch(readbackBody, new RegExp(secret));
    assert.match(readbackBody, /OpenAI-compatible Chat Completions/);
    assert.match(readbackBody, /test-model/);
    assert.match(readbackBody, /測試用謹慎風格/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
    settings.close();
  }
});
