import test from 'node:test';
import assert from 'node:assert/strict';
import { loadIslandGraph } from '../content/island.ts';
import { createInitialWorld } from '../engine/world.ts';
import { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { ModelSettingsStore, ProcessModelSecrets } from '../ai/model-settings.ts';
import type { WorldEvent } from '../domain/model.ts';
import { projectSnapshot, SQLiteObserverPort } from './observer-adapter.ts';
import { createObserverServer } from './server.ts';

const sourceTables = new URL('../../references/tables/', import.meta.url);

test('projects actual persisted source graph and all ten residents without inventing placements or models', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const world = createInitialWorld(graph, { seed: 'observer-adapter-test', contentVersion: 'test-source' });
  const legacyNodes = {
    ...world.nodes,
    '1': { ...world.nodes['1']!, regionDescription: '舊世界快照中的區域描述' },
  };
  const legacyWorld = { ...world, nodes: legacyNodes } as typeof world;
  const observedActor = world.actors['resident-01'];
  assert.ok(observedActor);
  const observedWorld = {
    ...legacyWorld,
    actors: { ...world.actors, [observedActor.id]: { ...observedActor, lastActionId: 'move:2', lastActionResult: '抵達 Node 2' } },
  };
  const store = SQLiteWorldStore.open(':memory:');
  store.commit(0, observedWorld, []);
  const port = new SQLiteObserverPort(store, { sourceGraph: graph });
  const snapshot = await port.readSnapshot();
  assert.equal(snapshot.initialized, true);
  assert.equal(snapshot.map.nodes.length, graph.nodes.length);
  assert.equal(snapshot.map.edges.length, 51);
  assert.equal(snapshot.residents.length, 10);
  assert.equal(snapshot.residents.find(({ id }) => id === observedActor.id)?.lastActionResult, '抵達 Node 2');
  assert.ok(snapshot.map.nodes.every((node) => !Object.hasOwn(node, 'regionDescription')));
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

test('projects settled public message text into the observer timeline', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const world = createInitialWorld(graph, { seed: 'observer-message-test', contentVersion: 'test-source' });
  const senderId = 'resident-01';
  const message: WorldEvent = {
    eventId: 'message-1', sequence: 1, worldTimeT: 1, actorId: senderId, nodeId: world.actors[senderId]?.nodeId ?? null,
    kind: 'public-message-sent', visibility: 'public', payload: { recipientId: 'resident-02', text: '請到河流集合' }, randomDraws: [],
  };
  const snapshot = projectSnapshot({ ...world, sequence: 1 }, [message], { sourceGraph: graph });
  assert.match(snapshot.events[0]?.description ?? '', /請到河流集合/);
});

test('projects dungeon resident cells from runtime locations without changing world state', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const world = createInitialWorld(graph, { seed: 'observer-dungeon-map-test', contentVersion: 'test-source' });
  const resident = world.actors['resident-01'];
  assert.ok(resident);
  const dungeonWorld = {
    ...world,
    actors: {
      ...world.actors,
      [resident.id]: { ...resident, nodeId: null, dungeonLocation: { tripId: 'trip-test', floor: 2, cellId: 'B2' } },
    },
    dungeonRuntime: {
      schemaVersion: 1 as const,
      tripId: 'trip-test',
      activeFloor: 2,
      cellByActorId: { [resident.id]: 'B2' },
      unlockedFloorByActorId: { [resident.id]: 2 },
      visitedCells: ['S', 'B1', 'B2'],
      activeEncounterByCell: {},
    },
  };
  const before = JSON.stringify(dungeonWorld);
  const projected = projectSnapshot(dungeonWorld, [], { sourceGraph: graph });
  assert.equal(projected.dungeonMap?.activeFloor, 2);
  assert.deepEqual(projected.dungeonMap?.cells.find(({ id }) => id === 'S')?.neighbors, ['A1', 'B1', 'C1']);
  assert.deepEqual(projected.dungeonMap?.residents, [{ actorId: resident.id, floor: 2, cellId: 'B2' }]);
  assert.equal(projected.residents.find(({ id }) => id === resident.id)?.dungeonCellId, 'B2');
  assert.equal(JSON.stringify(dungeonWorld), before, 'view projection must not mutate simulation state');
});

test('routes pause and resume requests to the runtime control port and rejects speed changes', async () => {
  const store = SQLiteWorldStore.open(':memory:');
  const calls: string[] = [];
  const server = createObserverServer(store, {
    control: {
      getState: () => ({ paused: false, speedMultiplier: 1 }),
      pause: () => { calls.push('pause'); },
      resume: () => { calls.push('resume'); },
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    for (const body of [{ kind: 'pause' }, { kind: 'resume' }]) {
      const response = await fetch(`${baseUrl}/api/control`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 200);
    }
    const speedResponse = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'speed', speedId: 'slow' }),
    });
    assert.equal(speedResponse.status, 400);
    assert.deepEqual(calls, ['pause', 'resume']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});

test('serves the observer page, real snapshot API and strict runtime-only controls over localhost HTTP', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const world = createInitialWorld(graph, { seed: 'observer-http-test', contentVersion: 'test-source' });
  const store = SQLiteWorldStore.open(':memory:');
  store.commit(0, world, []);
  const server = createObserverServer(store, { sourceGraph: graph });
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
    assert.doesNotMatch(result.markup, /data-control="(?:pause|resume)"/, 'the observer must not render runtime controls when no lifecycle control port exists');
    const dungeonViewResponse = await fetch(`${baseUrl}/api/observer?mapView=dungeon&dungeonFloor=2&dungeonCellId=B2`);
    const dungeonView = await dungeonViewResponse.json() as { markup: string };
    assert.match(dungeonView.markup, /<option value="dungeon" selected>地牢<\/option>/);
    assert.match(dungeonView.markup, /<option value="2" selected>第二層 · 溫泉下水道<\/option>/);
    assert.match(dungeonView.markup, /data-dungeon-cell="B2"/);
    assert.equal(store.readSnapshot()?.worldTimeT, world.worldTimeT, 'view selection must not alter simulation state');
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
  const server = createObserverServer(store, { sourceGraph: graph }, settings, secrets);
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
        apiKey: secret, inputUsdPerMillion: '0', outputUsdPerMillion: '0', maxInputTokens: '1000', maxContextCharacters: '12000', maxOutputTokens: '200',
        fallbackModels: 'test-fallback',
      }),
    });
    const savedBody = await saved.text();
    assert.equal(saved.status, 200);
    assert.doesNotMatch(savedBody, new RegExp(secret));
    assert.deepEqual(settings.readSlots()[0], {
      slotId: 1, provider: 'Local test provider', baseUrl: 'http://127.0.0.1:9999/v1', model: 'test-model',
      fallbackModels: ['test-fallback'], inputUsdPerMillion: 0, outputUsdPerMillion: 0,
      maxInputTokens: 1000, maxContextCharacters: 12000, maxOutputTokens: null, modelSizeB: null, sizeAtLeast8BConfirmed: false, styleDescription: '測試用謹慎風格', updatedAt: settings.readSlots()[0]?.updatedAt,
      credentialRef: settings.readSlots()[0]?.credentialRef,
    });
    const credentialRef = settings.readSlots()[0]?.credentialRef;
    assert.ok(credentialRef);
    assert.equal(secrets.getForCredential(credentialRef), secret);
    const readback = await fetch(`${baseUrl}/api/observer`);
    const readbackBody = await readback.text();
    assert.doesNotMatch(readbackBody, new RegExp(secret));
    assert.match(readbackBody, /Local test provider/);
    assert.match(readbackBody, /test-model/);
    assert.match(readbackBody, /測試用謹慎風格/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
    settings.close();
  }
});
