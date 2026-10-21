import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SeededRandom } from './random.ts';
import { loadIslandGraph } from '../content/island.ts';
import { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { createInitialWorld } from './world.ts';
import { availableActions, nextWorldEvent, orderNextResidents, settleAndCommitNextAction, settleAndCommitNextTimerEvent, settleNextAction, settleNextTimerEvent, settleResidentBiography, settleNextInvalidReply } from './simulation.ts';

const sourceTables = new URL('../../references/tables/', import.meta.url);

test('offers and atomically settles eating from a source food row', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'eat-action', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor,
      nextActionAtT: actor.id === actorId ? 0 : 100,
      ...(actor.id === actorId ? { hunger: 2, inventory: ['普通魚'] } : {}),
    }])),
  };
  const content = { foods: [{ name: '普通魚', fullness_change: '3', hp_change: '0', sleep_change: '0' }], equipment: [] };
  const eat = availableActions(state, actorId, graph, undefined, content).find(({ type }) => type === 'eat');
  assert.ok(eat);
  assert.equal(eat.costT, 1);
  const result = settleNextAction(state, { actorId, actionId: eat.id, timeCostT: 1, payload: eat.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[actorId]?.hunger, 5);
  assert.deepEqual(result.state.actors[actorId]?.inventory, []);
  assert.equal(result.event.kind, 'resident-ate');
  assert.equal((result.event.payload as { itemId: string }).itemId, '普通魚');
});

test('offers and atomically settles pickup without stacking or exceeding ten slots', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'pickup-action', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const nodeId = initial.actors[actorId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: actor.id === actorId ? 0 : 100 }])),
    objects: {
      test_item: { id: 'test_item', itemId: '普通魚', objectType: 'item' as const, corpseId: null, ownerActorId: null, nodeId, generatedAtT: 0, expiresAtT: 72, unique: false, provisional: false },
    },
  };
  const pickup = availableActions(state, actorId, graph).find(({ type }) => type === 'pickup');
  assert.ok(pickup);
  assert.equal(pickup.costT, 1);
  const result = settleNextAction(state, { actorId, actionId: pickup.id, timeCostT: 1, payload: pickup.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state.actors[actorId]?.inventory, ['普通魚']);
  assert.equal(result.state.objects.test_item, undefined);
  assert.equal(result.event.kind, 'item-picked-up');
});

test('offers and atomically settles equipping a source-backed item with derived combat stats', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'equip-action', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor,
      nextActionAtT: actor.id === actorId ? 0 : 100,
      ...(actor.id === actorId ? { inventory: ['鐵劍'] } : {}),
    }])),
  };
  const content = { foods: [], equipment: [{ name_zh: '鐵劍', slot: 'one_hand', attack: '5', defense: '0', speed_modifier: '0' }] };
  const equip = availableActions(state, actorId, graph, undefined, content).find(({ type }) => type === 'equip');
  assert.ok(equip);
  assert.equal(equip.costT, 1);
  const result = settleNextAction(state, { actorId, actionId: equip.id, timeCostT: 1, payload: equip.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[actorId]?.attack, 5);
  assert.equal(result.state.actors[actorId]?.equipment?.main_hand, '鐵劍');
  assert.deepEqual(result.state.actors[actorId]?.inventory, []);
  assert.equal(result.event.kind, 'item-equipped');
});

test('settles a legal same-Node resident attack through the source combat damage helper', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'attack-action', contentVersion: 'archive-01669CAC' });
  const attackerId = 'resident-01';
  const targetId = 'resident-02';
  const nodeId = initial.actors[attackerId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: 100 }])),
      [attackerId]: { ...initial.actors[attackerId]!, nodeId, nextActionAtT: 0, attack: 5 },
      [targetId]: { ...initial.actors[targetId]!, nodeId, nextActionAtT: 100, defense: 1, hitPoints: 8 },
    },
  };
  const attack = availableActions(state, attackerId, graph).find(({ id }) => id === `attack:${targetId}`);
  assert.ok(attack);
  assert.equal(attack.costT, 1);
  const result = settleNextAction(state, { actorId: attackerId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[targetId]?.hitPoints, 4);
  assert.equal(result.event.kind, 'resident-attacked');
  assert.equal((result.event.payload as { damage: number }).damage, 4);
});

test('resolves attack damage before waking a sleeping resident and wakes only a survivor', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'attack-wakes', contentVersion: 'archive-01669CAC' });
  const attackerId = 'resident-01';
  const targetId = 'resident-02';
  const nodeId = initial.actors[attackerId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: 100 }])),
      [attackerId]: { ...initial.actors[attackerId]!, nodeId, nextActionAtT: 0, attack: 5 },
      [targetId]: { ...initial.actors[targetId]!, nodeId, nextActionAtT: 72, defense: 1, hitPoints: 8, sleeping: true, sleepingSinceT: 48 },
    },
  };
  const attack = availableActions(state, attackerId, graph).find(({ id }) => id === `attack:${targetId}`);
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: attackerId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[targetId]?.hitPoints, 4);
  assert.equal(result.state.actors[targetId]?.sleeping, false);
  assert.equal(result.state.actors[targetId]?.nextActionAtT, 0);
});

test('materializes a long-lived corpse and drops possessions atomically on lethal resident damage', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'attack-death', contentVersion: 'archive-01669CAC' });
  const attackerId = 'resident-01';
  const targetId = 'resident-02';
  const nodeId = initial.actors[attackerId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: 100 }])),
      [attackerId]: { ...initial.actors[attackerId]!, nodeId, nextActionAtT: 0, attack: 9 },
      [targetId]: { ...initial.actors[targetId]!, nodeId, nextActionAtT: 100, defense: 1, hitPoints: 4, inventory: ['珍珠'], equipment: { main_hand: '勇者劍' } },
    },
  };
  const attack = availableActions(state, attackerId, graph).find(({ id }) => id === `attack:${targetId}`);
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: attackerId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[targetId]?.alive, false);
  assert.equal(result.state.actors[targetId]?.nodeId, null);
  assert.equal(result.state.privateLifeData?.[targetId]?.biographyStatus, 'pending');
  const corpse = Object.values(result.state.objects).find(({ remainsActorId }) => remainsActorId === targetId);
  assert.ok(corpse);
  assert.equal(corpse.expiresAtT, null);
  assert.deepEqual(Object.values(result.state.objects).filter(({ corpseId }) => corpseId === corpse.id).map(({ itemId }) => itemId).sort(), ['勇者劍', '珍珠']);
});

test('settles a legal move into transit, then resolves arrival through the timer queue', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'integration-run', contentVersion: 'archive-01669CAC' });
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  store.commit(0, initial, []);
  const schedule = orderNextResidents(initial);
  assert.equal(schedule.actionTimeT, 0);
  const actorId = schedule.actorIds[0];
  assert.ok(actorId);
  const actions = availableActions(initial, actorId, graph);
  const move = actions.find(({ type }) => type === 'move');
  assert.ok(move);
  const result = settleAndCommitNextAction(store, {
    actorId,
    actionId: move.id,
    timeCostT: move.costT,
    payload: move.payload,
  }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'resident-action-settled');
  assert.equal(result.state.sequence, 1);
  assert.equal(result.state.worldTimeT, 0);
  assert.equal(result.state.actors[actorId]?.nextActionAtT, 3);
  const targetNodeId = (move.payload as { readonly toNodeId: string }).toNodeId;
  assert.equal(result.state.actors[actorId]?.nodeId, null);
  assert.deepEqual(result.state.actors[actorId]?.travel, { fromNodeId: initial.actors[actorId]?.nodeId, toNodeId: targetNodeId, arrivesAtT: 3 });
  assert.equal(store.readSnapshot()?.actors[actorId]?.nodeId, null);
  assert.equal(store.readEvents().length, 1);
  assert.equal(store.readEvents()[0]?.randomDraws.length, 9);

  let rollingState = result.state;
  while (true) {
    const event = nextWorldEvent(rollingState);
    if (event.kind !== 'resident-action') break;
    const waitingActorId = event.actorIds[0];
    assert.ok(waitingActorId);
    const wait = availableActions(rollingState, waitingActorId, graph).find(({ id }) => id === 'wait');
    assert.ok(wait);
    const settled = settleAndCommitNextAction(store, {
      actorId: waitingActorId,
      actionId: wait.id,
      timeCostT: wait.costT,
      payload: wait.payload,
    }, graph);
    assert.equal(settled.ok, true);
    if (settled.ok) rollingState = settled.state;
  }
  assert.equal(nextWorldEvent(rollingState).kind, 'travel-arrival');
  const arrival = settleAndCommitNextTimerEvent(store);
  assert.equal(arrival.ok, true);
  if (!arrival.ok) return;
  assert.equal(arrival.state.actors[actorId]?.nodeId, targetNodeId);
  assert.equal(arrival.state.actors[actorId]?.travel, null);
  assert.equal(store.readSnapshot()?.actors[actorId]?.nodeId, targetNodeId);
  assert.ok(store.readEvents().some(({ kind }) => kind === 'resident-arrived'));
  store.close();
});

test('rejects a move over a non-edge and leaves the input world untouched', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const state = createInitialWorld(graph, { seed: 'reject-run', contentVersion: 'archive-01669CAC' });
  const actorId = orderNextResidents(state).actorIds[0];
  assert.ok(actorId);
  const result = settleNextAction(state, {
    actorId,
    actionId: 'move:25',
    timeCostT: 3,
    payload: { toNodeId: '25' },
  }, graph);
  assert.equal(result.ok, false);
  assert.equal(state.sequence, 0);
  assert.equal(Object.values(state.actors).every((actor) => actor.nextActionAtT === 0), true);
});

test('stores model intent privately with the settled action and never puts it in the public event', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'private-intent', contentVersion: 'archive-01669CAC' });
  const actorId = orderNextResidents(initial).actorIds[0];
  assert.ok(actorId);
  const wait = availableActions(initial, actorId, graph).find(({ id }) => id === 'wait');
  assert.ok(wait);

  const result = settleNextAction(initial, { actorId, actionId: wait.id, timeCostT: 1, payload: wait.payload, intent: '想找淡水' }, graph);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state.privateLifeData?.[actorId]?.intents, ['想找淡水']);
  assert.equal(result.event.visibility, 'public');
  assert.equal(JSON.stringify(result.event).includes('想找淡水'), false);
});

test('settles malformed model replies as a 1T hesitation and exposes the fixed result for the next prompt', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'invalid-reply', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: actor.id === actorId ? 0 : 100 }])),
  };
  const result = settleNextInvalidReply(state, actorId, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[actorId]?.nextActionAtT, 1);
  assert.equal(result.state.actors[actorId]?.lastActionResult, '動作格式錯誤');
  assert.equal(result.event.kind, 'resident-action-format-error');
  assert.deepEqual(result.event.payload, { result: '動作格式錯誤', hesitationText: '你剛剛似乎愣神了一下。', timeCostT: 1 });
});

test('processes object expiry before a same-time resident action', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'timer-tie', contentVersion: 'archive-01669CAC' });
  const actor = Object.values(initial.actors)[0];
  assert.ok(actor?.nodeId);
  const state = {
    ...initial,
    worldTimeT: 4,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, { ...resident, nextActionAtT: 5 }])),
    objects: {
      object_due: { id: 'object_due', itemId: 'test-item', ownerActorId: null, nodeId: actor.nodeId, generatedAtT: 0, expiresAtT: 5, unique: false, provisional: false },
    },
  };
  assert.deepEqual(nextWorldEvent(state), { kind: 'object-expiry', timeT: 5, objectId: 'object_due' });
  const result = settleNextAction(state, {
    actorId: 'resident-01', actionId: 'wait', timeCostT: 1, payload: {},
  }, graph);
  assert.equal(result.ok, false);
  assert.match(result.unresolved[0] ?? '', /object-expiry at T=5/);
});

test('advances through night without a global check and schedules only personal sleeping risk', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'no-global-risk', contentVersion: 'archive-01669CAC' });
  const state = {
    ...initial,
    worldTimeT: 48,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, { ...resident, nextActionAtT: 80 }])),
  };
  assert.equal(nextWorldEvent(state).kind, 'day-boundary');
  const sleeperId = 'resident-01';
  const nodeId = state.actors[sleeperId]?.nodeId;
  assert.ok(nodeId);
  const unsafeState = {
    ...state,
    actors: { ...state.actors, [sleeperId]: { ...state.actors[sleeperId]!, sleeping: true, unsafeEntryAtT: 48, nextActionAtT: 80 } },
    nodes: { ...state.nodes, [nodeId]: { ...state.nodes[nodeId]!, safe: false } },
  };
  const riskEvent = nextWorldEvent(unsafeState);
  assert.equal(riskEvent.kind, 'personal-sleep-risk-unresolved');
  if (riskEvent.kind === 'personal-sleep-risk-unresolved') {
    assert.equal(riskEvent.timeT, 51);
    assert.equal(riskEvent.actorId, sleeperId);
    assert.match(riskEvent.unresolved[0] ?? '', /no supplied table/);
  }
});

test('settles unsafe sleep risk from the shared area table and applies the selected effect', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'sleep-risk-effect', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const actor = initial.actors[actorId];
  assert.ok(actor?.nodeId);
  const startingRandomState = Array.from({ length: 500 }, (_, index) => (index + 1).toString(16).padStart(8, '0'))
    .find((candidate) => new SeededRandom(candidate).next('forest.sleep-risk.' + actor.nodeId + '.' + actorId + '.51').value < 0.175);
  assert.ok(startingRandomState);
  const state = {
    ...initial,
    worldTimeT: 48,
    rngState: startingRandomState,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, resident.id === actorId
      ? { ...resident, sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 80, hitPoints: 5 }
      : { ...resident, nextActionAtT: 80 }])),
    nodes: { ...initial.nodes, [actor.nodeId]: { ...initial.nodes[actor.nodeId]!, safe: false } },
  };
  const table = [
    { id: 'forest-negative', weightPercent: 50, polarity: 'negative' as const, payload: { hitPointChange: -2 } },
    { id: 'forest-neutral', weightPercent: 50, polarity: 'nonnegative' as const },
  ];
  const result = settleNextTimerEvent(state, {}, { sleepRiskTableByNode: { [actor.nodeId]: table } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'personal-sleep-risk-settled');
  assert.equal(result.state.actors[actorId]?.hitPoints, 3);
  assert.equal(result.state.actors[actorId]?.sleeping, true);
  assert.equal(result.randomDraws.length, 1);
});

test('records a missing unsafe sleep table as unresolved while advancing the scheduler', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'sleep-risk-unresolved', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const actor = initial.actors[actorId];
  assert.ok(actor?.nodeId);
  const state = {
    ...initial,
    worldTimeT: 48,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, resident.id === actorId
      ? { ...resident, sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 80 }
      : { ...resident, nextActionAtT: 80 }])),
    nodes: { ...initial.nodes, [actor.nodeId]: { ...initial.nodes[actor.nodeId]!, safe: false } },
  };
  const result = settleNextTimerEvent(state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.worldTimeT, 51);
  assert.match(result.state.unresolved?.at(-1)?.detail ?? '', /no source-backed area-entry outcome table/);
  assert.equal(nextWorldEvent(result.state).kind, 'personal-sleep-risk-unresolved');
});

test('safe sleeping residents do not schedule personal risk checks', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'safe-sleep-risk', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const actor = initial.actors[actorId];
  assert.ok(actor?.nodeId);
  const state = {
    ...initial,
    worldTimeT: 48,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, resident.id === actorId
      ? { ...resident, sleeping: true, unsafeEntryAtT: 48, nextActionAtT: 80 }
      : { ...resident, nextActionAtT: 80 }])),
    nodes: { ...initial.nodes, [actor.nodeId]: { ...initial.nodes[actor.nodeId]!, safe: true } },
  };
  assert.equal(nextWorldEvent(state).kind, 'day-boundary');
});

test('offers sleep only at night and holds the resident until dawn', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'sleep-action', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const state = {
    ...initial,
    worldTimeT: 48,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: actor.id === actorId ? 48 : 80 }])),
  };
  const actions = availableActions(state, actorId, graph);
  const sleep = actions.find(({ type }) => type === 'sleep');
  assert.ok(sleep);
  const result = settleNextAction(state, { actorId, actionId: sleep.id, timeCostT: sleep.costT, payload: sleep.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[actorId]?.sleeping, true);
  assert.equal(result.state.actors[actorId]?.sleepingSinceT, 48);
  assert.equal(result.state.actors[actorId]?.nextActionAtT, 72);
  assert.equal(availableActions(result.state, actorId, graph).length, 0);
  assert.equal(nextWorldEvent(result.state).kind, 'personal-sleep-risk-unresolved');

  const daytime = { ...state, worldTimeT: 0, actors: Object.fromEntries(Object.values(state.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: 0 }])) };
  assert.equal(availableActions(daytime, actorId, graph).some(({ type }) => type === 'sleep'), false);
});

test('restores sleep to three only after a full night and wakes at the day boundary', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'full-night', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const actor = initial.actors[actorId];
  assert.ok(actor?.nodeId);
  const state = {
    ...initial,
    worldTimeT: 71,
    actors: {
      ...initial.actors,
      [actorId]: { ...actor, sleep: 0, hunger: 4, sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 72 },
      ...Object.fromEntries(Object.values(initial.actors).filter(({ id }) => id !== actorId).map((resident) => [resident.id, { ...resident, nextActionAtT: 80 }])),
    },
    nodes: { ...initial.nodes, [actor.nodeId]: { ...initial.nodes[actor.nodeId]!, safe: true } },
  };
  assert.equal(nextWorldEvent(state).kind, 'day-boundary');
  const result = settleNextTimerEvent(state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[actorId]?.sleep, 3);
  assert.equal(result.state.actors[actorId]?.hunger, 3);
  assert.equal(result.state.actors[actorId]?.sleeping, false);
  assert.equal(result.state.actors[actorId]?.nextActionAtT, 72);
});

test('replaces a dead resident at dawn with a fresh generation in the same slot and current model binding', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'next-generation', contentVersion: 'archive-01669CAC' });
  const dead = initial.actors['resident-01'];
  assert.ok(dead?.nodeId);
  const state = {
    ...initial,
    worldTimeT: 71,
    actors: {
      ...initial.actors,
      [dead.id]: { ...dead, alive: false, hitPoints: 0, diedAtT: 48, inventory: [], nextActionAtT: 90 },
      ...Object.fromEntries(Object.values(initial.actors).filter(({ id }) => id !== dead.id).map((resident) => [resident.id, { ...resident, nextActionAtT: 90 }])),
    },
    objects: {
      ...initial.objects,
      'corpse-resident-01': { id: 'corpse-resident-01', itemId: null, objectType: 'corpse' as const, remainsActorId: dead.id, ownerActorId: null, nodeId: dead.nodeId, generatedAtT: 48, expiresAtT: null, unique: false, provisional: false },
      'corpse-loot-resident-01-1': { id: 'corpse-loot-resident-01-1', itemId: 'sword', objectType: 'item' as const, ownerActorId: null, nodeId: dead.nodeId, generatedAtT: 48, expiresAtT: null, unique: false, provisional: false },
    },
  };

  const nextLifeBinding = {
    slotId: 1, provider: 'provider', baseUrl: 'https://api.example.test/v1', model: 'model-next-life', fallbackModels: ['backup'],
    maxInputTokens: 4000, maxOutputTokens: 1000, updatedAt: '2026-10-20T00:00:00.000Z', credentialRef: 'slot-1@2026-10-20T00:00:00.000Z',
  };
  const result = settleNextTimerEvent(state, { 1: nextLifeBinding });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const replacement = Object.values(result.state.actors).find((actor) => actor.actorType === 'resident' && actor.slotId === '0' && actor.alive);
  assert.ok(replacement);
  assert.equal(replacement.generation, 2);
  assert.equal(replacement.hitPoints, 30);
  assert.equal(replacement.hunger, 5);
  assert.equal(replacement.sleep, 3);
  assert.equal(replacement.modelSlotId, 1);
  assert.equal(replacement.modelId, 'provider/model-next-life');
  assert.deepEqual(replacement.modelAssignment, nextLifeBinding);
  assert.equal(JSON.stringify(replacement.modelAssignment).includes('apiKey'), false);
  assert.deepEqual(replacement.inventory, []);
  assert.equal(replacement.nextActionAtT, 72);
  assert.equal(result.state.actors[dead.id]?.alive, false);
  assert.equal(result.state.objects['corpse-loot-resident-01-1']?.itemId, 'sword');
  assert.equal(replacement.nodeId === null ? null : result.state.nodes[replacement.nodeId]?.visualType, '海灘類');
});

test('materializes a permanent corpse and dropped inventory on daily-survival death, then waits for next dawn', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'death-drops', contentVersion: 'archive-01669CAC' });
  const actor = initial.actors['resident-01'];
  assert.ok(actor?.nodeId);
  const state = {
    ...initial,
    worldTimeT: 71,
    actors: {
      ...initial.actors,
      [actor.id]: { ...actor, hitPoints: 3, hunger: 1, inventory: ['raw-fish'], equipment: { weapon: 'iron-sword' }, nextActionAtT: 90 },
      ...Object.fromEntries(Object.values(initial.actors).filter(({ id }) => id !== actor.id).map((resident) => [resident.id, { ...resident, nextActionAtT: 90 }])),
    },
    privateLifeData: { [actor.id]: { intents: ['我想活下去'], biographyStatus: 'active' as const } },
  };

  const result = settleNextTimerEvent(state);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const dead = result.state.actors[actor.id];
  assert.equal(dead?.alive, false);
  assert.equal(dead?.diedAtT, 72);
  assert.deepEqual(dead?.inventory, []);
  const corpse = Object.values(result.state.objects).find((object) => object.objectType === 'corpse' && object.remainsActorId === actor.id);
  assert.ok(corpse);
  assert.equal(corpse.nodeId, actor.nodeId);
  assert.equal(corpse.expiresAtT, null);
  assert.ok(Object.values(result.state.objects).some((object) => object.itemId === 'raw-fish' && object.nodeId === actor.nodeId));
  assert.ok(Object.values(result.state.objects).some((object) => object.itemId === 'iron-sword' && object.nodeId === actor.nodeId));
  assert.deepEqual(result.state.privateLifeData?.[actor.id], { intents: ['我想活下去'], biographyStatus: 'pending' });
  assert.equal(Object.values(result.state.actors).some((resident) => resident.actorType === 'resident' && resident.slotId === actor.slotId && resident.alive && resident.generation === 2), false);
});

test('publishes a death biography only to the player and erases retained private intents after completion', () => {
  const actorId = 'resident-01';
  const state = {
    schemaVersion: 2 as const, sequence: 5, contentVersion: 'test', worldTimeT: 100, seed: 's', rngState: '00000001',
    actors: { [actorId]: { id: actorId, actorType: 'resident' as const, alive: false, nodeId: '1', nextActionAtT: 0, speed: 3, unsafeEntryAtT: 0, sleeping: false, generation: 1 } },
    nodes: {}, objects: {},
    privateLifeData: { [actorId]: { intents: ['曾希望找到朋友'], biographyStatus: 'pending' as const } },
  };

  const result = settleResidentBiography(state, actorId, '他曾尋找同行者，最後留在島上。');

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.visibility, 'player-only');
  assert.equal(result.event.kind, 'biography');
  assert.deepEqual(result.state.privateLifeData?.[actorId], { intents: [], biographyStatus: 'complete' });
  assert.equal(JSON.stringify(result.event).includes('曾希望找到朋友'), false);
});

test('scavenges one corpse item per explicit-cost action and carries the corpse through travel', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'corpse-actions', contentVersion: 'archive-01669CAC' });
  const actorId = orderNextResidents(initial).actorIds[0];
  assert.ok(actorId);
  const actor = initial.actors[actorId];
  assert.ok(actor?.nodeId);
  const corpseId = 'corpse-test';
  const lootId = 'corpse-loot-test';
  const remainingLootId = 'corpse-loot-remaining';
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, { ...resident, nextActionAtT: resident.id === actorId ? 0 : 100 }])),
    objects: {
      ...initial.objects,
      [corpseId]: { id: corpseId, itemId: null, objectType: 'corpse' as const, remainsActorId: 'dead-1', ownerActorId: null, nodeId: actor.nodeId, generatedAtT: 0, expiresAtT: null, unique: false, provisional: false },
      [lootId]: { id: lootId, itemId: 'old-apple', objectType: 'item' as const, corpseId, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: 0, expiresAtT: null, unique: false, provisional: false },
      [remainingLootId]: { id: remainingLootId, itemId: 'old-fishing-rod', objectType: 'item' as const, corpseId, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: 0, expiresAtT: null, unique: false, provisional: false },
    },
  };
  const scavenge = availableActions(state, actorId, graph).find(({ id }) => id === `scavenge-corpse:${lootId}`);
  assert.ok(scavenge);
  assert.equal(scavenge.costT, 1);
  const looted = settleNextAction(state, { actorId, actionId: scavenge.id, timeCostT: 1, payload: scavenge.payload }, graph);
  assert.equal(looted.ok, true);
  if (!looted.ok) return;
  assert.deepEqual(looted.state.actors[actorId]?.inventory, ['old-apple']);
  assert.equal(looted.state.objects[lootId], undefined);

  const carry = availableActions(looted.state, actorId, graph).find(({ id }) => id === `carry-corpse:${corpseId}`);
  assert.ok(carry);
  assert.equal(carry.costT, 1);
  const carried = settleNextAction(looted.state, { actorId, actionId: carry.id, timeCostT: 1, payload: carry.payload }, graph);
  assert.equal(carried.ok, true);
  if (!carried.ok) return;
  assert.equal(carried.state.objects[corpseId]?.ownerActorId, actorId);
  const fromNodeId = carried.state.actors[actorId]?.nodeId;
  assert.ok(fromNodeId);
  const toNodeId = graph.edges.find(({ source, target }) => source === fromNodeId || target === fromNodeId);
  assert.ok(toNodeId);
  const neighbor = toNodeId.source === fromNodeId ? toNodeId.target : toNodeId.source;
  const move = availableActions(carried.state, actorId, graph).find(({ id }) => id === `move:${neighbor}`);
  assert.ok(move);
  assert.equal(move.costT, 3);
  const moved = settleNextAction(carried.state, { actorId, actionId: move.id, timeCostT: 3, payload: move.payload }, graph);
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  const arrival = settleNextTimerEvent(moved.state);
  assert.equal(arrival.ok, true);
  if (arrival.ok) {
    assert.equal(arrival.state.actors[actorId]?.nodeId, neighbor);
    assert.equal(arrival.state.objects[corpseId]?.nodeId, neighbor);
    assert.equal(arrival.state.objects[remainingLootId]?.nodeId, neighbor);
    assert.equal(arrival.state.objects[remainingLootId]?.ownerActorId, actorId);
  }
});

test('reopens a disk world and preserves snapshot, event sequence, and RNG replay evidence', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'disk-replay', contentVersion: 'archive-01669CAC' });
  const directory = mkdtempSync(join(tmpdir(), `island-sim-reopen-${process.pid}-`));
  const path = join(directory, 'world.sqlite');
  const firstStore = SQLiteWorldStore.open(path);
  firstStore.commit(0, initial, []);
  const actorId = orderNextResidents(initial).actorIds[0];
  assert.ok(actorId);
  const action = availableActions(initial, actorId, graph).find(({ id }) => id === 'wait');
  assert.ok(action);
  const committed = settleAndCommitNextAction(firstStore, {
    actorId, actionId: action.id, timeCostT: action.costT, payload: action.payload,
  }, graph);
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  const committedRng = committed.state.rngState;
  const committedDraws = committed.event.randomDraws;
  firstStore.close();

  const reopened = SQLiteWorldStore.open(path);
  assert.equal(reopened.readSnapshot()?.sequence, 1);
  assert.equal(reopened.readSnapshot()?.rngState, committedRng);
  assert.deepEqual(reopened.readEvents()[0]?.randomDraws, committedDraws);
  const repeated = settleNextAction(initial, {
    actorId, actionId: action.id, timeCostT: action.costT, payload: action.payload,
  }, graph);
  assert.equal(repeated.ok, true);
  if (repeated.ok) assert.deepEqual(repeated.event.randomDraws, committedDraws);
  reopened.close();
});
