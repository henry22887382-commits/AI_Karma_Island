import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionDefinition } from '../domain/model.ts';
import { loadIslandGraph } from '../content/island.ts';
import { loadSimulationActionContent } from '../content/actions.ts';
import { availableActions, nextWorldEvent } from '../engine/simulation.ts';
import { createInitialWorld } from '../engine/world.ts';
import { SeededRandom, seedToState } from '../engine/random.ts';
import { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { choosePlaytestAction, PlaytestBot } from './playtest-bot.ts';

const sourceTables = new URL('../../references/tables/', import.meta.url);

test('playtest chooser samples the legal list reproducibly from a seed and safely handles no choices', () => {
  const actions: ActionDefinition[] = [
    { id: 'wait', type: 'wait', name: '等待', costT: 1, requiresText: false, payload: {}, payloadSchemaKey: 'empty' },
    { id: 'move:2', type: 'move', name: '移動', costT: 3, requiresText: false, payload: { toNodeId: '2' }, payloadSchemaKey: 'move-target' },
    { id: 'eat:berry', type: 'eat', name: '吃莓果', costT: 1, requiresText: false, payload: { itemId: '莓果' }, payloadSchemaKey: 'inventory-item-id' },
  ];
  const left = new SeededRandom(seedToState('selector-seed'));
  const right = new SeededRandom(seedToState('selector-seed'));
  const picksLeft = Array.from({ length: 8 }, () => choosePlaytestAction(actions, left)?.id);
  const picksRight = Array.from({ length: 8 }, () => choosePlaytestAction(actions, right)?.id);
  assert.deepEqual(picksLeft, picksRight);
  assert.ok(picksLeft.every((id) => actions.some((action) => action.id === id)));
  assert.equal(choosePlaytestAction([], left), null);
});

test('playtest bot commits a currently legal resident action through engine settlement', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const actionContent = await loadSimulationActionContent(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  try {
    const initial = createInitialWorld(graph, { seed: 'playtest-bot-seed', contentVersion: 'test-source' });
    store.commit(0, initial, []);
    const scheduled = nextWorldEvent(initial);
    assert.equal(scheduled.kind, 'resident-action');
    if (scheduled.kind !== 'resident-action') return;
    const actorId = scheduled.actorIds[0];
    assert.ok(actorId);
    const legalBefore = availableActions(initial, actorId, graph, undefined, actionContent);
    const seed = 'playtest-bot-seed';
    const expected = choosePlaytestAction(legalBefore, new SeededRandom(seedToState(seed)));
    assert.ok(expected);

    const result = new PlaytestBot({ store, graph, actionContent, seed }).stepOnce();

    assert.equal(result.kind, 'action');
    if (result.kind !== 'action') return;
    assert.equal(result.actionId, expected.id);
    assert.equal(result.sequence, 1);
    assert.equal(store.readEvents().length, 1);
    assert.equal(store.readEvents()[0]?.kind, result.eventKind);
    assert.equal(store.readSnapshot()?.sequence, 1);
  } finally {
    store.close();
  }
});

test('playtest bot resumes its selector from an auditable action draw offset', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const actionContent = await loadSimulationActionContent(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  try {
    const seed = 'playtest-resume-offset';
    const initial = createInitialWorld(graph, { seed, contentVersion: 'test-source' });
    store.commit(0, initial, []);
    const scheduled = nextWorldEvent(initial);
    assert.equal(scheduled.kind, 'resident-action');
    if (scheduled.kind !== 'resident-action') return;
    const actorId = scheduled.actorIds[0];
    assert.ok(actorId);
    const actions = availableActions(initial, actorId, graph, undefined, actionContent);
    const expectedRandom = new SeededRandom(seedToState(seed));
    for (let index = 0; index < 4; index += 1) expectedRandom.next('playtest-bot-resume-offset');
    const expected = choosePlaytestAction(actions, expectedRandom);
    assert.ok(expected);

    const result = new PlaytestBot({ store, graph, actionContent, seed, choiceDrawOffset: 4 }).stepOnce();

    assert.equal(result.kind, 'action');
    if (result.kind === 'action') assert.equal(result.actionId, expected.id);
  } finally {
    store.close();
  }
});

test('playtest bot synchronizes current CSV node metadata into an existing snapshot without resetting the world', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const actionContent = await loadSimulationActionContent(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  try {
    const initial = createInitialWorld(graph, { seed: 'snapshot-node-sync', contentVersion: 'existing-run' });
    const stale = {
      ...initial,
      sequence: 9,
      worldTimeT: 123,
      rngState: '1234abcd',
      actors: { ...initial.actors, 'resident-01': { ...initial.actors['resident-01']!, hitPoints: 17 } },
      nodes: {
        ...initial.nodes,
        '11': { ...initial.nodes['11']!, label: null, labelStatus: '未逐點命名', surfaceTerrain: null },
        '25': { ...initial.nodes['25']!, surfaceTerrain: null },
      },
    };
    const history = Array.from({ length: 9 }, (_, index) => ({
      eventId: `history-${index + 1}`,
      sequence: index + 1,
      worldTimeT: index + 1,
      actorId: null,
      nodeId: null,
      kind: 'test-history',
      visibility: 'public' as const,
      payload: {},
      randomDraws: [],
    }));
    store.commit(0, stale, history);

    new PlaytestBot({ store, graph, actionContent, seed: 'selector-seed' });

    const synced = store.readSnapshot();
    assert.ok(synced);
    assert.equal(synced.sequence, 10);
    assert.equal(synced.worldTimeT, 123);
    assert.equal(synced.rngState, '1234abcd');
    assert.equal(synced.actors['resident-01']?.hitPoints, 17);
    assert.equal(synced.nodes['11']?.surfaceTerrain, 'forest');
    assert.equal(synced.nodes['11']?.label, '河口森林');
    assert.equal(synced.nodes['25']?.surfaceTerrain, 'forest');
    assert.equal(synced.nodes['15']?.visualType, '港口');
    assert.equal(synced.nodes['15']?.surfaceTerrain, 'port');
    const repair = store.readEvents().at(-1);
    assert.equal(repair?.kind, 'simulation-lineage-repair');
    assert.equal((repair?.payload as { randomDrawsConsumed: boolean }).randomDrawsConsumed, false);

    new PlaytestBot({ store, graph, actionContent, seed: 'selector-seed' });
    assert.equal(store.readSnapshot()?.sequence, 10, 'an unchanged source does not add another repair event');
    assert.equal(store.readEvents().length, 10);
  } finally {
    store.close();
  }
});

test('playtest bot can run the shared world to a world-time horizon', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const actionContent = await loadSimulationActionContent(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  try {
    const initial = createInitialWorld(graph, { seed: 'playtest-horizon', contentVersion: 'test-source' });
    store.commit(0, initial, []);
    const result = new PlaytestBot({ store, graph, actionContent, seed: 'playtest-horizon' }).runUntilWorldTimeT(1);
    assert.equal(result.stopped, false);
    assert.ok(result.steps > 0);
    assert.ok(result.worldTimeT >= 1);
  } finally {
    store.close();
  }
});

test('playtest bot settles the existing every-three-T sleep risk resolver for a classified Node', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const actionContent = await loadSimulationActionContent(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  try {
    const initial = createInitialWorld(graph, { seed: 'playtest-sleep-risk-resolver', contentVersion: 'test-source' });
    const actorId = 'resident-01';
    const sleeper = initial.actors[actorId];
    assert.ok(sleeper?.nodeId);
    const objectsWithoutDefaultCampfire = Object.fromEntries(
      Object.entries(initial.objects).filter(([id]) => id !== 'default-campfire-node-25'),
    );
    const state = {
      ...initial,
      worldTimeT: 48,
      objects: objectsWithoutDefaultCampfire,
      actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, actor.id === actorId
        ? { ...actor, nodeId: '25', sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 80 }
        : { ...actor, nextActionAtT: 80 }])),
    };
    store.commit(0, state, []);
    assert.equal(nextWorldEvent(state).kind, 'personal-sleep-risk-unresolved');
    const step = new PlaytestBot({ store, graph, actionContent, seed: 'sleep-risk-bot' }).stepOnce();
    assert.equal(step.kind, 'timer');
    if (step.kind !== 'timer') return;
    assert.equal(step.eventKind, 'personal-sleep-risk-settled');
    assert.equal(store.readSnapshot()?.worldTimeT, 51);
    assert.equal(store.readSnapshot()?.sequence, 1);
  } finally {
    store.close();
  }
});

test('playtest bot stops without committing when a sleep-risk terrain is unclassified', async () => {
  const sourceGraph = await loadIslandGraph(sourceTables);
  const graph = {
    ...sourceGraph,
    nodes: sourceGraph.nodes.map((node) => node.id === '3' ? { ...node, surfaceTerrain: null } : node),
  };
  const actionContent = await loadSimulationActionContent(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  try {
    const initial = createInitialWorld(graph, { seed: 'playtest-unmapped-sleep-risk', contentVersion: 'test-source' });
    const actorId = 'resident-01';
    const state = {
      ...initial,
      worldTimeT: 48,
      actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, actor.id === actorId
        ? { ...actor, nodeId: '3', sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 80 }
        : { ...actor, nextActionAtT: 80 }])),
      nodes: { ...initial.nodes, '3': { ...initial.nodes['3']!, surfaceTerrain: null } },
    };
    store.commit(0, state, []);
    const step = new PlaytestBot({ store, graph, actionContent, seed: 'sleep-risk-bot' }).stepOnce();
    assert.equal(step.kind, 'stopped');
    if (step.kind === 'stopped') assert.match(step.reason, /Node 3/);
    assert.equal(store.readSnapshot()?.sequence, 0);
    assert.equal(store.readSnapshot()?.worldTimeT, 48);
    assert.equal(store.readEvents().length, 0);
  } finally {
    store.close();
  }
});

test('playtest bot stops at an all-dead world instead of advancing without residents', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const actionContent = await loadSimulationActionContent(sourceTables);
  const store = SQLiteWorldStore.open(':memory:');
  try {
    const initial = createInitialWorld(graph, { seed: 'playtest-all-dead', contentVersion: 'test-source' });
    const deadWorld = { ...initial, actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, alive: false, nodeId: null }])) };
    store.commit(0, deadWorld, []);
    const result = new PlaytestBot({ store, graph, actionContent, seed: 'playtest-all-dead' }).runUntilWorldTimeT(1);
    assert.equal(result.stopped, true);
    assert.equal(result.reason, '所有居民均已死亡。');
    assert.equal(result.steps, 0);
  } finally {
    store.close();
  }
});
