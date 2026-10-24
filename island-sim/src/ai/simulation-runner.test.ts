import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { loadIslandGraph } from '../content/island.ts';
import { loadSimulationActionContent } from '../content/actions.ts';
import { createInitialWorld } from '../engine/world.ts';
import { nextWorldEvent } from '../engine/simulation.ts';
import { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { ModelSettingsStore, ProcessModelSecrets } from './model-settings.ts';
import { modelAssignmentsBySlot } from './model-binding.ts';
import { createBoundProviders } from './provider-factory.ts';
import { SimulationRunner } from './simulation-runner.ts';

const sourceTables = new URL('../../references/tables/', import.meta.url);

test('unconfigured next resident is paused before any provider request or world commit', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  const settings = new ModelSettingsStore(new DatabaseSync(':memory:'));
  const secrets = new ProcessModelSecrets();
  const state = createInitialWorld(graph, { seed: 'runner-unconfigured', contentVersion: 'test-source' });
  store.commit(0, state, []);
  let requests = 0;
  const runner = new SimulationRunner({ store, settings, secrets, graph, fetcher: async () => { requests += 1; throw new Error('must not be called'); } });
  try {
    await runner.stepOnce();
    assert.equal(store.readSnapshot()?.sequence, 0);
    assert.equal(requests, 0);
    assert.match(runner.getState().status, /尚未完成模型與金鑰設定/);
  } finally {
    store.close();
    settings.close();
  }
});

test('runner automatically settles the scheduled monster turn without requesting an AI decision', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const actionContent = await loadSimulationActionContent(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  const settings = new ModelSettingsStore(new DatabaseSync(':memory:'));
  const secrets = new ProcessModelSecrets();
  const initial = createInitialWorld(graph, { seed: 'runner-monster-automatic', contentVersion: 'test-source' });
  const resident = Object.values(initial.actors).find((actor) => actor.alive);
  assert.ok(resident?.nodeId);
  const monster = {
    id: 'monster-runner-test', actorType: 'monster' as const, alive: true, nodeId: resident.nodeId,
    nextActionAtT: 0, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 10, defense: 0, attack: 0,
    name: '森林野豬', travel: null,
  };
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: 100 }])),
  };
  store.commit(0, { ...state, actors: { ...state.actors, [monster.id]: monster } }, []);
  let requests = 0;
  const runner = new SimulationRunner({ store, settings, secrets, graph, actionContent, fetcher: async () => { requests += 1; throw new Error('monster actions are automatic'); } });
  try {
    await runner.stepOnce();
    assert.equal(requests, 0);
    assert.equal(store.readSnapshot()?.sequence, 1);
    assert.equal(store.readEvents()[0]?.kind, 'monster-action-settled');
    assert.equal(store.readSnapshot()?.actors[monster.id]?.nextActionAtT, 1);
  } finally {
    store.close();
    settings.close();
  }
});

test('local HTTP model completes one legal resident action with atomic actual-cost settlement', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  const settings = new ModelSettingsStore(new DatabaseSync(':memory:'));
  const secrets = new ProcessModelSecrets();
  let requests = 0;
  const transportErrors: string[] = [];
  const requestBodies: string[] = [];
  const server = createServer(async (request, response) => {
    requests += 1;
    const auth = request.headers.authorization;
    assert.match(auth ?? '', /^Bearer test-key-/);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requestBodies.push(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ action_id: 'wait', intent: '先稍作等待' }) } }],
      usage: { prompt_tokens: 23, completion_tokens: 7 },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    for (let slotId = 1; slotId <= 10; slotId += 1) {
      const saved = settings.saveSlot({
        slotId, provider: 'local', baseUrl: `http://127.0.0.1:${address.port}/v1`, model: `resident-model-${slotId}`,
        fallbackModels: [], inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxInputTokens: 20000, maxOutputTokens: 256,
        modelSizeB: null, sizeAtLeast8BConfirmed: true, styleDescription: `本地測試槽位 ${slotId}`,
      });
      secrets.set(saved.credentialRef, `test-key-${slotId}`);
    }
    const assignments = modelAssignmentsBySlot(settings.readSlots(), secrets);
    const world = createInitialWorld(graph, { seed: 'runner-local-provider', contentVersion: 'test-source', modelAssignmentsBySlot: assignments });
    const ordered = Object.values(world.actors).find((actor) => actor.alive && actor.modelAssignment);
    assert.ok(ordered);
    const providerCheck = createBoundProviders({ actor: ordered, settings, secrets, store });
    assert.equal(providerCheck.ok, true);
    if (providerCheck.ok) assert.equal(providerCheck.primary.ready, true);
    const schedule = nextWorldEvent(world);
    const nextActorId = schedule.kind === 'resident-action' ? schedule.actorIds[0] : undefined;
    assert.ok(nextActorId);
    const nextActor = world.actors[nextActorId];
    assert.ok(nextActor);
    const nextProviderCheck = createBoundProviders({ actor: nextActor, settings, secrets, store });
    assert.equal(nextProviderCheck.ok, true, nextProviderCheck.ok ? '' : nextProviderCheck.unresolved);
    if (nextProviderCheck.ok) assert.equal(nextProviderCheck.primary.ready, true);
    store.commit(0, world, []);
    const runner = new SimulationRunner({
      store, settings, secrets, graph, intervalMs: 60_000,
      fetcher: async (input, init) => {
        try {
          return await fetch(input, init);
        } catch (error) {
          transportErrors.push(error instanceof Error ? `${error.name}: ${error.message}` : 'unknown transport error');
          throw error;
        }
      },
    });
    await runner.stepOnce();
    assert.equal(requests, 1, `${runner.getState().status}; transport=${transportErrors.join('|')}`);
    assert.equal(requestBodies.length, 1);
    assert.match(requestBodies[0] ?? '', /此居民槽位風格描述/);
    assert.match(requestBodies[0] ?? '', /available_actions/);
    assert.doesNotMatch(requestBodies[0] ?? '', /test-key-/);
    assert.equal(store.readSnapshot()?.sequence, 1);
    const events = store.readEvents(0, 10);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, 'resident-action-settled');
    const actorId = events[0]?.actorId;
    assert.ok(actorId);
    assert.deepEqual(store.readSnapshot()?.privateLifeData?.[actorId]?.intents, ['先稍作等待']);
    assert.equal(JSON.stringify(events[0]?.payload).includes('先稍作等待'), false);
    const costs = store.readMonthlyCost(new Date().toISOString());
    assert.equal(costs.settledUsd, 0);
    assert.equal(costs.reservedUsd, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
    settings.close();
  }
});
