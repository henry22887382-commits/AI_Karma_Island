import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SeededRandom } from './random.ts';
import type { WorldActor } from '../domain/model.ts';
import { loadIslandGraph } from '../content/island.ts';
import { loadSimulationActionContent } from '../content/actions.ts';
import { parseCsv } from '../content/csv.ts';
import { resolveSurfaceEntry } from '../domain/surface.ts';
import { resolveNightEncounterCheck } from '../domain/night-encounter.ts';
import { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { createInitialWorld, syncWorldNodeNotices } from './world.ts';
import { resolveDungeonRuntimeStep } from './dungeon-runtime.ts';
import { availableActions, nextWorldEvent, orderNextResidents, settleAndCommitNextAction, settleAndCommitNextTimerEvent, settleNextAction, settleNextTimerEvent, settleResidentBiography, settleNextInvalidReply } from './simulation.ts';
import { buildAiInput, formatAiNarrativeEvent } from '../ai/view.ts';

const sourceTables = new URL('../../references/tables/', import.meta.url);

test('read action exposes mapped text only after same-Node settlement', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'read-action', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const nodeId = initial.actors[actorId]!.nodeId!;
  const text = 'USER_SUPPLIED_TEXT_FIXTURE';
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor, nextActionAtT: actor.id === actorId ? 0 : 100,
    }])),
    objects: {
      ...initial.objects,
      sign: { id: 'sign', itemId: '告示牌', objectType: 'item' as const, readableTextId: 'sign-main', ownerActorId: null, nodeId, generatedAtT: 0, expiresAtT: null, unique: false, provisional: false },
    },
  };
  const content = { foods: [], equipment: [], readableTexts: { 'sign-main': text } };
  assert.equal(availableActions(state, actorId, graph, undefined, { foods: [], equipment: [] }).some(({ type }) => type === 'read'), false);
  assert.equal(availableActions(state, actorId, graph, undefined, { foods: [], equipment: [], readableTexts: { 'sign-main': '  \n  ' } }).some(({ type }) => type === 'read'), false);
  const legalActions = availableActions(state, actorId, graph, undefined, content);
  const read = legalActions.find(({ id }) => id === 'read:sign');
  assert.ok(read);
  assert.equal(read.costT, 1);
  const before = buildAiInput(state, actorId, legalActions.map(({ id, type, name, costT, requiresText, payload }) => ({ id, type, name, costT, requiresText, payload: payload as Readonly<Record<string, unknown>> })), [], formatAiNarrativeEvent);
  assert.equal(before.ok, true);
  if (before.ok) assert.equal(JSON.stringify(before.input).includes(text), false);

  const settled = settleNextAction(state, { actorId, actionId: read.id, timeCostT: 1, payload: read.payload }, graph, undefined, content);
  assert.equal(settled.ok, true, settled.ok ? '' : JSON.stringify(settled.unresolved));
  if (!settled.ok) return;
  assert.equal(settled.event.kind, 'object-read');
  const after = buildAiInput(settled.state, actorId, availableActions(settled.state, actorId, graph, undefined, content).map(({ id, type, name, costT, requiresText, payload }) => ({ id, type, name, costT, requiresText, payload: payload as Readonly<Record<string, unknown>> })), [settled.event], formatAiNarrativeEvent);
  assert.equal(after.ok, true);
  if (after.ok) assert.equal(after.input.narration.includes(text), true);
});

test('production blank book text does not expose READ for a same-Node object', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'blank-book-object', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const nodeId = initial.actors[actorId]!.nodeId!;
  const content = await loadSimulationActionContent(sourceTables);
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor, nextActionAtT: actor.id === actorId ? 0 : 100,
    }])) as typeof initial.actors,
    objects: {
      ...initial.objects,
      blankBook: { id: 'blankBook', itemId: '書籍', objectType: 'item' as const, readableTextId: 'book-001', ownerActorId: null, nodeId, generatedAtT: 0, expiresAtT: null, unique: false, provisional: false },
    },
  };

  assert.equal(content.readableTexts['book-001'], '');
  assert.equal(availableActions(state, actorId, graph, undefined, content).some(({ type }) => type === 'read'), false);
});

test('node notice bindings create visible readable signs that are not picked up and persist until destroyed', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'node-notice-read', contentVersion: 'test-source' });
  const actor = initial.actors['resident-01'];
  assert.ok(actor?.nodeId);
  const text = '這是此 Node 的告示內容';
  const actors = Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, {
    ...resident, nextActionAtT: resident.id === actor.id ? 0 : 100,
  }])) as typeof initial.actors;
  const state = syncWorldNodeNotices({ ...initial, actors }, [{ node_id: actor.nodeId, document_id: 'notice-test' }]);
  const objectId = `editor-notice-${actor.nodeId}`;
  const loadedContent = await loadSimulationActionContent(sourceTables);
  const content = { ...loadedContent, readableTexts: { ...loadedContent.readableTexts, 'notice-test': text } };
  const actions = availableActions(state, actor.id, graph, undefined, content);
  const read = actions.find((action) => action.id === `read:${objectId}`);
  assert.ok(read);
  assert.equal(actions.some((action) => action.id === `pickup:${objectId}`), false);
  assert.equal(actions.some((action) => action.id === `destroy-placed:${objectId}`), true);

  const readResult = settleNextAction(state, { actorId: actor.id, actionId: read.id, timeCostT: read.costT, payload: read.payload }, graph, undefined, content);
  assert.equal(readResult.ok, true, JSON.stringify(readResult));
  if (!readResult.ok) return;
  assert.equal(readResult.event.kind, 'object-read');
  const readPayload = readResult.event.payload;
  assert.ok(readPayload && typeof readPayload === 'object' && !Array.isArray(readPayload));
  assert.equal((readPayload as Record<string, unknown>).text, text);
  assert.equal(readResult.state.objects[objectId]?.expiresAtT, null);

  const destroy = availableActions(readResult.state, actor.id, graph, undefined, content).find((action) => action.id === `destroy-placed:${objectId}`);
  assert.ok(destroy);
  const destroyed = settleNextAction(readResult.state, { actorId: actor.id, actionId: destroy.id, timeCostT: destroy.costT, payload: destroy.payload }, graph, undefined, content);
  assert.equal(destroyed.ok, true);
  if (!destroyed.ok) return;
  assert.equal(destroyed.state.objects[objectId], undefined);
  assert.deepEqual(destroyed.state.destroyedNodeNoticeKeys, [`${actor.nodeId}:notice-test`]);
  const store = SQLiteWorldStore.open(':memory:');
  store.commit(0, state, []);
  store.commit(state.sequence, readResult.state, [readResult.event]);
  store.commit(readResult.state.sequence, destroyed.state, [destroyed.event]);
  const reloaded = store.readSnapshot();
  assert.ok(reloaded);
  assert.equal(syncWorldNodeNotices(reloaded, [{ node_id: actor.nodeId, document_id: 'notice-test' }]).objects[objectId], undefined);

  const rebound = syncWorldNodeNotices(reloaded, [{ node_id: actor.nodeId, document_id: 'notice-test-2' }]);
  assert.equal(rebound.objects[objectId]?.readableTextId, 'notice-test-2');
  assert.equal(rebound.objects[objectId]?.expiresAtT, null);
  assert.equal(availableActions(rebound, actor.id, graph, undefined, {
    ...content, readableTexts: { ...content.readableTexts, 'notice-test-2': '新告示' },
  }).some((action) => action.id === `pickup:${objectId}`), false);
  store.close();
});

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
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.unresolved));
  if (!result.ok) return;
  assert.equal(result.state.actors[actorId]?.hunger, 5);
  assert.deepEqual(result.state.actors[actorId]?.inventory, []);
  assert.equal(result.event.kind, 'resident-ate');
  assert.equal((result.event.payload as { itemId: string }).itemId, '普通魚');
});

test('dungeon entry and cell moves persist runtime, cell position, event draws, and created objects with each action', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: '00002400', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const state = {
    ...initial,
    rngState: '00002400',
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor, nodeId: actor.id === actorId ? '21' : actor.nodeId,
      nextActionAtT: actor.id === actorId ? 0 : 100,
    }])),
  };
  const productionContent = { ...await loadSimulationActionContent(sourceTables) };
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  store.commit(0, state, []);

  const enter = availableActions(state, actorId, graph, undefined, productionContent).find(({ id }) => id === 'dungeon-enter');
  assert.ok(enter);
  const entered = settleAndCommitNextAction(store, { actorId, actionId: enter.id, timeCostT: 3, payload: enter.payload }, graph, undefined, productionContent);
  assert.equal(entered.ok, true);
  if (!entered.ok) return;
  assert.equal(store.readSnapshot()?.actors[actorId]?.dungeonLocation?.cellId, 'S');
  assert.ok(store.readSnapshot()?.dungeonRuntime?.visitedCells.includes('1:S'));
  assert.ok(store.readSnapshot()?.objects['action-1-resident-01:dungeon:container']);
  assert.equal(store.readEvents().at(-1)?.kind, 'dungeon-action-settled');
  assert.equal(store.readEvents().at(-1)?.randomDraws.length, 1);

  const enteredState = store.readSnapshot();
  assert.ok(enteredState);
  const container = enteredState.objects['action-1-resident-01:dungeon:container'];
  assert.ok(container);
  assert.equal(container.itemId, '遺失背包');
  assert.equal(container.containerSourceId, '第一層遺失背包');
  assert.equal(availableActions(enteredState, actorId, graph, undefined, productionContent).some(({ id }) => id === `container-open:${container.id}`), true);
  const content = {
    ...productionContent,
    containerCategoryWeights: [{ source: '第一層遺失背包', category: '食物', category_percent: '100' }],
    containerItemSubpools: [{ source: '第一層遺失背包', category: '食物', item: '椰子', within_category_percent: '100' }],
  };
  const open = availableActions(enteredState, actorId, graph, undefined, content).find(({ id }) => id === `container-open:${container.id}`);
  assert.ok(open);
  assert.equal(open.costT, 1);
  const uniqueBefore = enteredState.uniqueOwnerByItemId;
  const opened = settleAndCommitNextAction(store, { actorId, actionId: open.id, timeCostT: 1, payload: open.payload }, graph, undefined, content);
  assert.equal(opened.ok, true, opened.ok ? '' : JSON.stringify(opened.unresolved));
  if (!opened.ok) return;
  const openedState = store.readSnapshot();
  assert.ok(openedState);
  assert.equal(openedState.objects[container.id], undefined);
  assert.equal(openedState.actors[actorId]?.inventory?.length, 1);
  assert.equal(opened.event.kind, 'container-opened');
  assert.equal(opened.event.randomDraws.length, 2);
  assert.deepEqual(openedState.uniqueOwnerByItemId, uniqueBefore);
  assert.equal(openedState.actors[actorId]?.inventory?.[0], (opened.event.payload as { itemId: string }).itemId);
  const nextActions = availableActions(openedState, actorId, graph, undefined, content);
  const move = nextActions.find(({ id }) => id === 'dungeon-move:A1');
  assert.ok(move);
  const moved = settleAndCommitNextAction(store, { actorId, actionId: move.id, timeCostT: 3, payload: move.payload }, graph, undefined, content);
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(store.readSnapshot()?.actors[actorId]?.dungeonLocation?.cellId, 'A1');
  assert.equal(store.readSnapshot()?.dungeonRuntime?.cellByActorId[actorId], 'A1');
  assert.equal(store.readEvents().length, 3);
});

test('full inventory opens a container into a same-location world drop in the same settlement', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'full-container', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const actor = initial.actors[actorId]!;
  const location = { tripId: 'trip-full', floor: 1, cellId: 'A1' };
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((candidate) => [candidate.id, { ...candidate, nextActionAtT: candidate.id === actorId ? 0 : 100 }])),
      [actorId]: { ...actor, nodeId: '21', dungeonLocation: location, inventory: Array.from({ length: 10 }, (_, i) => `item-${i}`), nextActionAtT: 0 },
    },
    objects: {
      ...initial.objects,
      chest: { id: 'chest', itemId: '遺失背包', objectType: 'container' as const, ownerActorId: null, nodeId: 'S', dungeonLocation: location, containerSourceId: '測試來源', generatedAtT: 0, expiresAtT: 72, unique: false, provisional: true },
    },
  };
  const content = {
    foods: [{ name: '椰子' }], equipment: [],
    containerCategoryWeights: [{ source: '測試來源', category: '食物', category_percent: '100' }],
    containerItemSubpools: [{ source: '測試來源', category: '食物', item: '椰子', within_category_percent: '100' }],
    containerItemIdentities: [{ source_label: '椰子', inventory_id: '椰子', category: '食物' }],
  };
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  store.commit(0, state, []);
  const open = availableActions(state, actorId, graph, undefined, content).find(({ id }) => id === 'container-open:chest');
  assert.ok(open);
  const result = settleAndCommitNextAction(store, { actorId, actionId: open.id, timeCostT: open.costT, payload: open.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const eventPayload = result.event.payload as { itemId: string; sourceItemLabel: string; overflowObjectId: string | null };
  assert.equal(eventPayload.itemId, '椰子');
  assert.equal(eventPayload.sourceItemLabel, '椰子');
  assert.ok(eventPayload.overflowObjectId);
  assert.equal(result.state.objects.chest, undefined);
  const drop = result.state.objects[eventPayload.overflowObjectId!];
  assert.equal(drop?.itemId, '椰子');
  assert.equal(drop?.nodeId, state.actors[actorId]?.nodeId);
  assert.deepEqual(drop?.dungeonLocation, location);
  assert.equal(drop?.generatedAtT, 0);
  assert.equal(drop?.expiresAtT, 72);
  assert.equal(result.state.actors[actorId]?.inventory?.length, 10);
  assert.equal(store.readSnapshot()?.objects[eventPayload.overflowObjectId!]?.itemId, '椰子');
  assert.equal(store.readEvents().at(-1)?.kind, 'container-opened');
});

test('all production container outcomes resolve to stable inventory IDs and expose 1T open actions', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'container-source-map', contentVersion: 'archive-01669CAC' });
  const content = await loadSimulationActionContent(sourceTables);
  const actorId = 'resident-01';
  const actor = initial.actors[actorId]!;
  const sources = [...new Set(content.containerItemSubpools.map(({ source }) => source).filter((source): source is string => typeof source === 'string' && source.length > 0))];
  assert.equal(sources.length, 7);
  for (const source of sources) {
    const object = { id: 'container', itemId: '容器', objectType: 'container' as const, ownerActorId: null, nodeId: actor.nodeId, containerSourceId: source, generatedAtT: 0, expiresAtT: 72, unique: false, provisional: true };
    const state = { ...initial, objects: { ...initial.objects, container: object } };
    const open = availableActions(state, actorId, graph, undefined, content).find(({ id }) => id === 'container-open:container');
    assert.equal(open?.costT, 1, source);
  }
  assert.equal(content.containerItemIdentities?.length, 27);
  assert.equal(content.containerItemSubpools?.length, 46);
  assert.equal(content.containerItemIdentities?.every((row) => Boolean(row.source_label && row.inventory_id && row.category)), true);
  assert.equal(new Set(content.containerItemIdentities?.map(({ source_label }) => source_label)).size, 27);
  assert.equal(content.containerItemSubpools?.every((row) => content.containerItemIdentities?.some((identity) => identity.source_label === row.item && identity.category === row.category)), true);
});

test('container settlement keeps unique-owner ledger consistent for inventory delivery and overflow drops', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'container-unique-ledger', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const actor = initial.actors[actorId]!;
  const source = '測試唯一容器';
  const content = {
    foods: [], equipment: [{ name_zh: '勇者劍' }],
    containerCategoryWeights: [{ source, category: '武器', category_percent: '100' }],
    containerItemSubpools: [{ source, category: '武器', item: '測試唯一劍', within_category_percent: '100' }],
    containerItemIdentities: [{ source_label: '測試唯一劍', inventory_id: '勇者劍', category: '武器' }],
  };
  for (const full of [false, true]) {
    const location = { tripId: `trip-${full}`, floor: 1, cellId: 'A1' };
    const state = {
      ...initial,
      actors: Object.fromEntries(Object.values(initial.actors).map((candidate) => [candidate.id, candidate.id === actorId
        ? { ...actor, nodeId: '21', dungeonLocation: location, inventory: full ? Array.from({ length: 10 }, (_, index) => `item-${index}`) : [], nextActionAtT: 0 }
        : { ...candidate, nextActionAtT: 100 }])),
      objects: { ...initial.objects, chest: { id: 'chest', itemId: '測試容器', objectType: 'container' as const, ownerActorId: null, nodeId: 'S', dungeonLocation: location, containerSourceId: source, generatedAtT: 0, expiresAtT: 72, unique: false, provisional: true } },
    };
    const open = availableActions(state, actorId, graph, undefined, content).find(({ id }) => id === 'container-open:chest');
    assert.ok(open);
    const result = settleNextAction(state, { actorId, actionId: open.id, timeCostT: open.costT, payload: open.payload }, graph, undefined, content);
    assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.unresolved));
    if (!result.ok) return;
    assert.equal(result.state.uniqueOwnerByItemId?.['勇者劍'], full ? undefined : actorId);
    if (full) {
      const payload = result.event.payload as { overflowObjectId: string | null };
      const drop = payload.overflowObjectId === null ? undefined : result.state.objects[payload.overflowObjectId];
      assert.equal(drop?.itemId, '勇者劍');
      assert.equal(drop?.unique, true);
      assert.equal(drop?.expiresAtT, null);
    }
  }
});

test('entering the dungeon Boss cell enqueues a scheduled attack against only same-trip, same-floor, same-cell residents', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: '3c6ef362', contentVersion: 'archive-01669CAC' });
  const monsters = parseCsv(readFileSync(new URL('../../references/tables/monsters.csv', import.meta.url), 'utf8'));
  const attackDistributions = parseCsv(readFileSync(new URL('../../references/tables/attack_distributions.csv', import.meta.url), 'utf8'));
  const dungeonEvents = parseCsv(readFileSync(new URL('../../references/tables/dungeon_events.csv', import.meta.url), 'utf8'));
  const tripId = 'boss-encounter-test';
  const residentId = 'resident-01';
  const otherFloorResidentId = 'resident-02';
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
    ...actor, nodeId: null, nextActionAtT: 100,
  }]));
  actors[residentId] = {
    ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 0,
    dungeonLocation: { tripId, floor: 3, cellId: 'A2' },
  };
  actors[otherFloorResidentId] = {
    ...initial.actors[otherFloorResidentId]!, nodeId: '21', nextActionAtT: 100,
    dungeonLocation: { tripId, floor: 2, cellId: 'E' },
  };
  const state = {
    ...initial, rngState: '3c6ef362', actors,
    dungeonRuntime: {
      schemaVersion: 1 as const, tripId, activeFloor: 3, cellByActorId: { [residentId]: 'A2' },
      unlockedFloorByActorId: { [residentId]: 3 }, visitedCells: ['3:A2'], activeEncounterByCell: {},
      routeByActorId: { [residentId]: [] },
    },
  };
  const content = { foods: [], equipment: [], monsters, attackDistributions, dungeonEvents };
  const bossEntryAction = availableActions(state, residentId, graph, undefined, content).find(({ id }) => id === 'dungeon-move:E');
  assert.ok(bossEntryAction);
  const entered = settleNextAction(state, {
    actorId: residentId, actionId: bossEntryAction.id, timeCostT: 3, payload: bossEntryAction.payload,
  }, graph, undefined, content);
  assert.equal(entered.ok, true);
  if (!entered.ok) return;
  const boss = Object.values(entered.state.actors).find((actor) => actor.actorType === 'monster' && actor.name === '巨龍');
  assert.ok(boss);
  assert.deepEqual(boss.dungeonLocation, { tripId, floor: 3, cellId: 'E' });
  assert.equal(boss.spawnedAtSequence, entered.state.sequence);
  const spawnRoundNextEvent = nextWorldEvent(entered.state);
  assert.equal(spawnRoundNextEvent.kind, 'resident-action');
  if (spawnRoundNextEvent.kind !== 'resident-action') return;
  const nextResidentId = spawnRoundNextEvent.actorIds[0];
  assert.ok(nextResidentId);
  const wait = availableActions(entered.state, nextResidentId, graph, undefined, content).find(({ id }) => id === 'wait');
  assert.ok(wait);
  const advancedRound = settleNextAction(entered.state, {
    actorId: nextResidentId, actionId: wait.id, timeCostT: wait.costT, payload: wait.payload,
  }, graph, undefined, content);
  assert.equal(advancedRound.ok, true);
  if (!advancedRound.ok) return;
  const monsterTurn = nextWorldEvent(advancedRound.state);
  assert.equal(monsterTurn.kind, 'monster-action');
  if (monsterTurn.kind !== 'monster-action') return;
  assert.equal(monsterTurn.monsterId, boss.id);

  const result = settleNextTimerEvent(advancedRound.state, {}, { monsters, attackDistributions });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'monster-action-settled');
  assert.ok(result.event.randomDraws.length > 0);
  assert.ok(result.state.actors[residentId]!.hitPoints! < advancedRound.state.actors[residentId]!.hitPoints!);
  assert.equal(result.state.actors[otherFloorResidentId]!.hitPoints, initial.actors[otherFloorResidentId]!.hitPoints);
  const hits = (result.event.payload as { hits: readonly { targetId: string }[] }).hits;
  assert.ok(hits.length > 0);
  assert.ok(hits.every(({ targetId }) => targetId === residentId));
});

test('production timer settles Dragon breath against every same-cell participant with independent damage draws', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const monsters = parseCsv(readFileSync(new URL('../../references/tables/monsters.csv', import.meta.url), 'utf8'));
  const attackDistributions = parseCsv(readFileSync(new URL('../../references/tables/attack_distributions.csv', import.meta.url), 'utf8'));
  const initial = createInitialWorld(graph, { seed: '3c6ef362', contentVersion: 'archive-01669CAC' });
  const tripId = 'dragon-production-breath-trip';
  const firstId = 'resident-01';
  const secondId = 'resident-02';
  const otherFloorId = 'resident-03';
  const bossId = 'dragon-production-boss';
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }]));
  for (const id of [firstId, secondId]) actors[id] = { ...initial.actors[id]!, nodeId: '21', nextActionAtT: 100, hitPoints: 100, defense: 0, dungeonLocation: { tripId, floor: 3, cellId: 'E' } };
  actors[otherFloorId] = { ...initial.actors[otherFloorId]!, nodeId: '21', nextActionAtT: 100, hitPoints: 100, defense: 0, dungeonLocation: { tripId, floor: 2, cellId: 'E' } };
  actors[bossId] = { id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 10, speed: 3, unsafeEntryAtT: 0, travel: null, sleeping: false, hitPoints: 75, attack: 0, defense: 0, name: '巨龍', encounterId: tripId, dungeonLocation: { tripId, floor: 3, cellId: 'E' } };
  const state = { ...initial, worldTimeT: 10, rngState: '3c6ef362', actors };
  const result = settleNextTimerEvent(state, {}, { monsters, attackDistributions });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.event.payload as { action: string }).action, 'breath');
  const hits = (result.event.payload as { hits: readonly { targetId: string; appliedDamage: number }[] }).hits;
  assert.deepEqual(hits.map(({ targetId }) => targetId).sort(), [firstId, secondId].sort());
  assert.ok(hits.every(({ appliedDamage }) => appliedDamage >= 20 && appliedDamage <= 22));
  assert.equal(result.state.actors[otherFloorId]?.hitPoints, 100);
  assert.equal(result.randomDraws.length, 3);
});

test('production third-floor event rolls separate lava-splash HP loss and ignores resident DEF', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const dungeonEvents = parseCsv(readFileSync(new URL('../../references/tables/dungeon_events.csv', import.meta.url), 'utf8'));
  const content = { foods: [], equipment: [], dungeonEvents };
  const residentId = 'resident-01';
  const tripId = 'lava-splash-production-trip';
  const cases = [
    { seed: '00002000', expectedDamage: 4, hitPoints: 30 },
    { seed: '00002016', expectedDamage: 5, hitPoints: 30 },
    { seed: '0000202b', expectedDamage: 6, hitPoints: 30 },
    { seed: '0000202b', expectedDamage: 6, hitPoints: 5 },
  ] as const;
  for (const scenario of cases) {
    const initial = createInitialWorld(graph, { seed: scenario.seed, contentVersion: 'archive-01669CAC' });
    const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }]));
    actors[residentId] = { ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 0, hitPoints: scenario.hitPoints, defense: 100, inventory: scenario.hitPoints === 5 ? ['raw-fish'] : [], dungeonLocation: { tripId, floor: 3, cellId: 'S' } };
    const state = { ...initial, rngState: scenario.seed, actors, dungeonRuntime: { schemaVersion: 1 as const, tripId, activeFloor: 3, cellByActorId: { [residentId]: 'S' }, unlockedFloorByActorId: { [residentId]: 3 }, visitedCells: ['3:S'], activeEncounterByCell: {} } };
    const move = availableActions(state, residentId, graph, undefined, content).find(({ id }) => id === 'dungeon-move:A1');
    assert.ok(move);
    const result = settleNextAction(state, { actorId: residentId, actionId: move.id, timeCostT: 3, payload: move.payload }, graph, undefined, content);
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal((result.event.payload as { lavaSplashDamage?: number }).lavaSplashDamage, scenario.expectedDamage);
    assert.equal(result.state.actors[residentId]?.hitPoints, Math.max(0, scenario.hitPoints - scenario.expectedDamage));
    assert.equal(result.state.actors[residentId]?.alive, scenario.hitPoints > scenario.expectedDamage);
    assert.equal(result.state.actors[residentId]?.dungeonLocation?.cellId ?? null, scenario.hitPoints > scenario.expectedDamage ? 'A1' : null);
    if (scenario.hitPoints <= scenario.expectedDamage) {
      assert.ok(Object.values(result.state.objects).some((object) => object.objectType === 'corpse' && object.remainsActorId === residentId));
      assert.ok(Object.values(result.state.objects).some((object) => object.itemId === 'raw-fish' && object.corpseId !== null));
    }
    assert.equal(result.randomDraws.length, 2);
  }

  const initial = createInitialWorld(graph, { seed: '3c6ef362', contentVersion: 'archive-01669CAC' });
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }]));
  actors[residentId] = { ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 0, hitPoints: 30, defense: 100, dungeonLocation: { tripId, floor: 3, cellId: 'S' } };
  const nonSplashState = { ...initial, rngState: '3c6ef362', actors, dungeonRuntime: { schemaVersion: 1 as const, tripId, activeFloor: 3, cellByActorId: { [residentId]: 'S' }, unlockedFloorByActorId: { [residentId]: 3 }, visitedCells: ['3:S'], activeEncounterByCell: {} } };
  const move = availableActions(nonSplashState, residentId, graph, undefined, content).find(({ id }) => id === 'dungeon-move:A1');
  assert.ok(move);
  const nonSplash = settleNextAction(nonSplashState, { actorId: residentId, actionId: move.id, timeCostT: 3, payload: move.payload }, graph, undefined, content);
  assert.equal(nonSplash.ok, true);
  if (nonSplash.ok) {
    assert.equal((nonSplash.event.payload as { dungeonEvents: readonly { payload: { event: string } }[] }).dungeonEvents[0]?.payload.event, '火山彈');
    assert.equal(nonSplash.state.actors[residentId]?.hitPoints, 30);
    assert.equal(nonSplash.randomDraws.length, 1);
  }
});

test('production third-floor non-first-row event draw settles from the reweighted pool', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const dungeonEvents = parseCsv(readFileSync(new URL('../../references/tables/dungeon_events.csv', import.meta.url), 'utf8'));
  const content = { foods: [], equipment: [], dungeonEvents };
  const initial = createInitialWorld(graph, { seed: 'd007-nonfirst-row', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const tripId = 'd007-nonfirst-row-trip';
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }]));
  actors[residentId] = { ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 0, dungeonLocation: { tripId, floor: 3, cellId: 'A1' } };
  const state = { ...initial, rngState: 'd0070001', actors, dungeonRuntime: { schemaVersion: 1 as const, tripId, activeFloor: 3, cellByActorId: { [residentId]: 'A1' }, unlockedFloorByActorId: { [residentId]: 3 }, visitedCells: ['3:A1'], activeEncounterByCell: {} } };
  const move = availableActions(state, residentId, graph, undefined, content).find(({ id }) => id === 'dungeon-move:A2');
  assert.ok(move);
  const result = settleNextAction(state, { actorId: residentId, actionId: move.id, timeCostT: 3, payload: move.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.state.rngState, 'd0070001');
  assert.equal(result.state.actors[residentId]?.dungeonLocation?.cellId, 'A2');
  const eventPayloads = (result.event.payload as { dungeonEvents: readonly { kind: string; payload: { event?: string } }[] }).dungeonEvents;
  const event = eventPayloads.find(({ kind }) => kind === 'dungeon-cell-event');
  assert.ok(event);
  assert.notEqual(event.payload.event, '火山彈');
  assert.ok(result.event.randomDraws.some(({ sourceId }) => sourceId === 'dungeon.event.火山洞窟.A2'));
});

test('resident ordinary hits can break Boss 2 defense once only when attack exceeds four', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'boss2-breakthrough-action', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const bossId = 'boss-catpaw-test';
  const tripId = 'boss2-trip';
  const makeState = (attack: number) => {
    const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor, nodeId: null, nextActionAtT: 100,
    }]));
    actors[residentId] = {
      ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 0, attack,
      dungeonLocation: { tripId, floor: 2, cellId: 'E' },
    };
    actors[bossId] = {
      id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 100, speed: 6,
      unsafeEntryAtT: 0, travel: null, sleeping: false, defense: 4, name: '大貓爪',
      encounterId: tripId, dungeonLocation: { tripId, floor: 2, cellId: 'E' }, boss2Breakthroughs: 0,
    };
    return { ...initial, actors };
  };
  const lowAttackState = makeState(4);
  const lowAttackAction = availableActions(lowAttackState, residentId, graph).find(({ id }) => id === `attack:${bossId}`);
  assert.ok(lowAttackAction);
  const lowAttack = settleNextAction(lowAttackState, {
    actorId: residentId, actionId: lowAttackAction.id, timeCostT: 1, payload: lowAttackAction.payload,
  }, graph);
  assert.equal(lowAttack.ok, true);
  if (!lowAttack.ok) return;
  assert.equal(lowAttack.state.actors[bossId]?.boss2Breakthroughs, 0);

  const highAttackState = makeState(5);
  const highAttackAction = availableActions(highAttackState, residentId, graph).find(({ id }) => id === `attack:${bossId}`);
  assert.ok(highAttackAction);
  const highAttack = settleNextAction(highAttackState, {
    actorId: residentId, actionId: highAttackAction.id, timeCostT: 1, payload: highAttackAction.payload,
  }, graph);
  assert.equal(highAttack.ok, true);
  if (!highAttack.ok) return;
  assert.equal(highAttack.state.actors[bossId]?.boss2Breakthroughs, 1);
  assert.equal(highAttack.state.actors[bossId]?.alive, true);
  assert.equal(highAttack.event.kind, 'boss2-defense-breakthrough');
  assert.deepEqual(highAttack.randomDraws, []);
});

test('the fifth Boss 2 breakthrough retreats the Boss and atomically grants same-cell access and last-hitter rewards', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'boss2-fifth-breakthrough', contentVersion: 'archive-01669CAC' });
  const winnerId = 'resident-01';
  const partnerId = 'resident-02';
  const otherTripId = 'resident-03';
  const bossId = 'boss-catpaw-victory';
  const tripId = 'boss2-victory-trip';
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
    ...actor, nodeId: null, nextActionAtT: 100,
  }]));
  actors[winnerId] = {
    ...initial.actors[winnerId]!, nodeId: '21', nextActionAtT: 0, attack: 5, inventory: [],
    dungeonLocation: { tripId, floor: 2, cellId: 'E' },
  };
  actors[partnerId] = {
    ...initial.actors[partnerId]!, nodeId: '21', nextActionAtT: 100,
    dungeonLocation: { tripId, floor: 2, cellId: 'E' },
  };
  actors[otherTripId] = {
    ...initial.actors[otherTripId]!, nodeId: '21', nextActionAtT: 100,
    dungeonLocation: { tripId: 'other-trip', floor: 2, cellId: 'E' },
  };
  actors[bossId] = {
    id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 100, speed: 6,
    unsafeEntryAtT: 0, travel: null, sleeping: false, defense: 4, name: '大貓爪',
    encounterId: tripId, dungeonLocation: { tripId, floor: 2, cellId: 'E' }, boss2Breakthroughs: 4,
  };
  const state = {
    ...initial, actors,
    dungeonRuntime: {
      schemaVersion: 1 as const, tripId, activeFloor: 2, cellByActorId: { [winnerId]: 'E', [partnerId]: 'E', [otherTripId]: 'E' },
      unlockedFloorByActorId: { [winnerId]: 2, [partnerId]: 2, [otherTripId]: 2 }, visitedCells: ['2:E'], activeEncounterByCell: {},
      routeByActorId: { [winnerId]: ['A2'], [partnerId]: ['A2'], [otherTripId]: ['A2'] },
    },
  };
  const attack = availableActions(state, winnerId, graph, undefined, content).find(({ id }) => id === `attack:${bossId}`);
  assert.ok(attack);
  const result = settleNextAction(state, {
    actorId: winnerId, actionId: attack.id, timeCostT: 1, payload: attack.payload,
  }, graph, undefined, content);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'boss2-retreated');
  assert.equal(result.state.actors[bossId], undefined);
  assert.deepEqual(result.state.dungeonRuntime?.unlockedFloorByActorId, { [winnerId]: 3, [partnerId]: 3, [otherTripId]: 2 });
  assert.ok(result.state.actors[winnerId]?.inventory?.some((item) => item.endsWith('毛線球')));
  const rewardArmor = result.state.actors[winnerId]?.inventory?.find((itemId) => content.equipment.some((row) => row.name_zh === itemId && row.tier === 'knight' && row.category !== 'weapon'));
  assert.ok(rewardArmor);
  assert.equal(result.state.actors[partnerId]?.inventory?.length, 0);
  assert.equal(result.state.actors[otherTripId]?.inventory?.length, 0);
  assert.deepEqual(result.state.actors[winnerId]?.dungeonLocation, { tripId, floor: 3, cellId: 'S' });
  assert.deepEqual(result.state.actors[partnerId]?.dungeonLocation, { tripId, floor: 3, cellId: 'S' });
  assert.deepEqual(result.state.actors[otherTripId]?.dungeonLocation, { tripId: 'other-trip', floor: 2, cellId: 'E' });
  assert.equal(result.randomDraws.length, 2);
});

test('Boss 2 victory spills both source rewards at the Node when the last hitter inventory is full', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'boss2-full-inventory-reward', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const bossId = 'boss-catpaw-full-inventory';
  const tripId = 'boss2-full-inventory-trip';
  const inventory = Array.from({ length: 10 }, (_, index) => `held-${index + 1}`);
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }]));
  actors[residentId] = { ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 0, attack: 5, inventory, dungeonLocation: { tripId, floor: 2, cellId: 'E' } };
  actors[bossId] = { id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 100, speed: 6, unsafeEntryAtT: 0, travel: null, sleeping: false, defense: 4, name: '大貓爪', encounterId: tripId, dungeonLocation: { tripId, floor: 2, cellId: 'E' }, boss2Breakthroughs: 4 };
  const state = { ...initial, actors, dungeonRuntime: { schemaVersion: 1 as const, tripId, activeFloor: 2, cellByActorId: { [residentId]: 'E' }, unlockedFloorByActorId: { [residentId]: 2 }, visitedCells: ['2:E'], activeEncounterByCell: {} } };
  const attack = availableActions(state, residentId, graph, undefined, content).find(({ id }) => id === `attack:${bossId}`);
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'boss2-retreated');
  assert.deepEqual(result.state.actors[residentId]?.inventory, inventory);
  const rewards = Object.values(result.state.objects).filter((object) => object.itemId !== null && object.nodeId === '21' && object.dungeonLocation?.tripId === tripId && object.dungeonLocation.floor === 3 && object.dungeonLocation.cellId === 'S' && object.id.startsWith('boss2-reward-'));
  assert.equal(rewards.length, 2);
  assert.ok(rewards.some((object) => object.itemId?.endsWith('毛線球')));
  assert.ok(rewards.some((object) => content.equipment.some((row) => row.name_zh === object.itemId && row.tier === 'knight' && row.category !== 'weapon')));
  assert.ok(rewards.every((object) => object.generatedAtT === result.event.worldTimeT && object.expiresAtT === result.event.worldTimeT + 72));
});

test('resident retreat before the fifth Boss 2 breakthrough is not the Boss victory retreat and grants no access', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'boss2-early-retreat', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const tripId = 'boss2-early-retreat-trip';
  const bossId = `boss-${tripId}-floor-2`;
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
    ...actor, nodeId: null, nextActionAtT: 100,
  }]));
  actors[residentId] = {
    ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 0, dungeonRouteHistory: ['A2'],
    dungeonLocation: { tripId, floor: 2, cellId: 'E' },
  };
  actors[bossId] = {
    id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 100, speed: 6,
    unsafeEntryAtT: 0, travel: null, sleeping: false, defense: 4, name: '大貓爪',
    encounterId: tripId, dungeonLocation: { tripId, floor: 2, cellId: 'E' }, boss2Breakthroughs: 4,
  };
  const state = {
    ...initial, actors,
    dungeonRuntime: {
      schemaVersion: 1 as const, tripId, activeFloor: 2, cellByActorId: { [residentId]: 'E' },
      unlockedFloorByActorId: { [residentId]: 2 }, visitedCells: ['2:A2', '2:E'], activeEncounterByCell: {},
      routeByActorId: { [residentId]: ['A2'] },
    },
  };
  const retreat = availableActions(state, residentId, graph, undefined, content).find(({ id }) => id === 'dungeon-retreat:A2');
  assert.ok(retreat);
  const result = settleNextAction(state, {
    actorId: residentId, actionId: retreat.id, timeCostT: 3, payload: retreat.payload,
  }, graph, undefined, content);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'dungeon-resident-retreated');
  assert.equal(result.state.actors[residentId]?.dungeonLocation?.cellId, 'A2');
  assert.equal(result.state.actors[bossId], undefined);
  assert.equal(result.state.dungeonRuntime?.unlockedFloorByActorId[residentId], 2);
});

test('scheduled Boss 1 taunt and flying actions persist their encounter status through one T', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const monsters = parseCsv(readFileSync(new URL('../../references/tables/monsters.csv', import.meta.url), 'utf8'));
  const attackDistributions = parseCsv(readFileSync(new URL('../../references/tables/attack_distributions.csv', import.meta.url), 'utf8'));
  const residentId = 'resident-01';
  const tripId = 'boss1-status-trip';
  const cases = [
    { seed: '00003800', expectedAction: 'taunt', expectedTaunted: true, expectedInvulnerableUntilT: null },
    { seed: '00003000', expectedAction: 'flying', expectedTaunted: false, expectedInvulnerableUntilT: 11 },
  ] as const;
  for (const scenario of cases) {
    const initial = createInitialWorld(graph, { seed: scenario.seed, contentVersion: 'archive-01669CAC' });
    const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor, nodeId: null, nextActionAtT: 100,
    }]));
    actors[residentId] = {
      ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 100,
      dungeonLocation: { tripId, floor: 1, cellId: 'E' },
    };
    const bossId = 'boss-parrot-status-test';
    actors[bossId] = {
      id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 10, speed: 2,
      unsafeEntryAtT: 0, travel: null, sleeping: false, hitPoints: 15, attack: 0, defense: 0,
      name: '大金剛鸚鵡', encounterId: tripId, dungeonLocation: { tripId, floor: 1, cellId: 'E' },
    };
    const state = { ...initial, worldTimeT: 10, rngState: scenario.seed, actors };
    const result = settleNextTimerEvent(state, {}, { monsters, attackDistributions });
    if (!result.ok) throw new Error(JSON.stringify(result.unresolved));
    assert.equal(result.event.kind, 'monster-action-settled');
    assert.equal((result.event.payload as { action: string }).action, scenario.expectedAction);
    assert.equal(result.state.actors[bossId]?.taunted ?? false, scenario.expectedTaunted);
    assert.equal(result.state.actors[bossId]?.invulnerableUntilT ?? null, scenario.expectedInvulnerableUntilT);
  }
});

test('attacking a taunting Boss 1 invalidates the resident hit and settles one immediate counterattack', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'parrot-taunt-counter', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const bossId = 'boss-parrot-taunt-test';
  const tripId = 'parrot-taunt-trip';
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
    ...actor, nodeId: null, nextActionAtT: 100,
  }]));
  actors[residentId] = {
    ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 10, attack: 5, defense: 0, hitPoints: 30,
    dungeonLocation: { tripId, floor: 1, cellId: 'E' },
  };
  actors[bossId] = {
    id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 100, speed: 2,
    unsafeEntryAtT: 0, travel: null, sleeping: false, hitPoints: 15, attack: 0, defense: 0,
    name: '大金剛鸚鵡', encounterId: tripId, dungeonLocation: { tripId, floor: 1, cellId: 'E' }, taunted: true,
  };
  const state = { ...initial, worldTimeT: 10, actors };
  const action = availableActions(state, residentId, graph, undefined, content).find(({ id }) => id === `attack:${bossId}`);
  assert.ok(action);
  const result = settleNextAction(state, {
    actorId: residentId, actionId: action.id, timeCostT: 1, payload: action.payload,
  }, graph, undefined, content);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'boss1-taunt-counterattack');
  assert.equal(result.state.actors[bossId]?.hitPoints, 15);
  assert.equal(result.state.actors[bossId]?.taunted, false);
  assert.equal(result.state.actors[bossId]?.nextActionAtT, 11);
  assert.ok(result.state.actors[residentId]!.hitPoints! < 30);
  assert.equal((result.event.payload as { residentHitLanded: boolean }).residentHitLanded, false);
  assert.equal((result.event.payload as { bossAttacks: readonly unknown[] }).bossAttacks.length, 1);
});

test('Boss 1 flying blocks resident damage only before the one-T window boundary', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'parrot-flying-boundary', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const bossId = 'boss-parrot-flying-test';
  const tripId = 'parrot-flying-trip';
  for (const scenario of [{ timeT: 10, blocked: true }, { timeT: 11, blocked: false }]) {
    const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }]));
    actors[residentId] = { ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: scenario.timeT, attack: 5, dungeonLocation: { tripId, floor: 1, cellId: 'E' } };
    actors[bossId] = { id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, travel: null, sleeping: false, hitPoints: 15, attack: 0, defense: 0, name: '大金剛鸚鵡', encounterId: tripId, dungeonLocation: { tripId, floor: 1, cellId: 'E' }, invulnerableUntilT: 11 };
    const state = { ...initial, worldTimeT: scenario.timeT, actors };
    const attack = availableActions(state, residentId, graph, undefined, content).find(({ id }) => id === `attack:${bossId}`);
    assert.ok(attack);
    const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph, undefined, content);
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.event.kind, scenario.blocked ? 'boss1-flying-hit-blocked' : 'resident-attacked');
    assert.equal(result.state.actors[bossId]?.hitPoints, scenario.blocked ? 15 : 10);
  }
});

test('defeating Boss 1 grants source armor and memento to the last hitter and floor two access to living same-cell participants', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'boss1-victory-reward', contentVersion: 'archive-01669CAC' });
  const winnerId = 'resident-01';
  const partnerId = 'resident-02';
  const outsideId = 'resident-03';
  const bossId = 'boss-parrot-victory-test';
  const tripId = 'parrot-victory-trip';
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }]));
  actors[winnerId] = { ...initial.actors[winnerId]!, nodeId: '21', nextActionAtT: 10, attack: 5, dungeonLocation: { tripId, floor: 1, cellId: 'E' } };
  actors[partnerId] = { ...initial.actors[partnerId]!, nodeId: '21', nextActionAtT: 100, dungeonLocation: { tripId, floor: 1, cellId: 'E' } };
  actors[outsideId] = { ...initial.actors[outsideId]!, nodeId: '21', nextActionAtT: 100, dungeonLocation: { tripId, floor: 2, cellId: 'E' } };
  actors[bossId] = { id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, travel: null, sleeping: false, hitPoints: 5, attack: 0, defense: 0, name: '大金剛鸚鵡', encounterId: tripId, dungeonLocation: { tripId, floor: 1, cellId: 'E' } };
  const state = { ...initial, worldTimeT: 10, actors, dungeonRuntime: { schemaVersion: 1 as const, tripId, activeFloor: 1, cellByActorId: { [winnerId]: 'E', [partnerId]: 'E', [outsideId]: 'E' }, unlockedFloorByActorId: { [winnerId]: 1, [partnerId]: 1, [outsideId]: 1 }, visitedCells: ['1:E'], activeEncounterByCell: {} } };
  const attack = availableActions(state, winnerId, graph, undefined, content).find(({ id }) => id === `attack:${bossId}`);
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: winnerId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'boss1-defeated');
  assert.equal(result.state.actors[bossId]?.alive, false);
  assert.equal(result.state.dungeonRuntime?.unlockedFloorByActorId[winnerId], 2);
  assert.equal(result.state.dungeonRuntime?.unlockedFloorByActorId[partnerId], 2);
  assert.equal(result.state.dungeonRuntime?.unlockedFloorByActorId[outsideId], 1);
  assert.deepEqual(result.state.actors[winnerId]?.dungeonLocation, { tripId, floor: 2, cellId: 'S' });
  assert.deepEqual(result.state.actors[partnerId]?.dungeonLocation, { tripId, floor: 2, cellId: 'S' });
  assert.deepEqual(result.state.actors[outsideId]?.dungeonLocation, { tripId, floor: 2, cellId: 'E' });
  const ironArmor = content.equipment.filter((row) => row.tier === 'iron' && row.category !== 'weapon').map((row) => row.name_zh);
  assert.ok(ironArmor.some((item) => result.state.actors[winnerId]?.inventory?.includes(item ?? '')));
  assert.ok(result.state.actors[winnerId]?.inventory?.some((item) => item.endsWith('玻璃珠')));
});

test('Boss 2 unlock exposes third-floor entry using the non-first-row production pool', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'boss2-floor-three-entry', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const tripId = 'boss2-floor-three-trip';
  const bossId = `boss-${tripId}-floor-2`;
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }]));
  actors[residentId] = { ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 10, dungeonLocation: { tripId, floor: 2, cellId: 'E' } };
  actors[bossId] = { id: bossId, actorType: 'monster', alive: false, nodeId: null, nextActionAtT: 9, speed: 6, unsafeEntryAtT: 0, travel: null, sleeping: false, defense: 4, name: '大貓爪', encounterId: tripId, dungeonLocation: { tripId, floor: 2, cellId: 'E' }, boss2Breakthroughs: 5 };
  const state = { ...initial, worldTimeT: 10, actors, dungeonRuntime: { schemaVersion: 1 as const, tripId, activeFloor: 2, cellByActorId: { [residentId]: 'E' }, unlockedFloorByActorId: { [residentId]: 3 }, visitedCells: ['2:E'], activeEncounterByCell: {} } };
  const advance = availableActions(state, residentId, graph, undefined, content).find(({ id }) => id === 'dungeon-advance-floor:3');
  assert.ok(advance);
  const result = settleNextAction(state, { actorId: residentId, actionId: advance.id, timeCostT: 3, payload: advance.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[residentId]?.dungeonLocation?.floor, 3);
  assert.equal(result.state.actors[residentId]?.dungeonLocation?.cellId, 'S');
  assert.equal(result.state.dungeonRuntime?.activeFloor, 3);
  assert.equal(result.state.dungeonRuntime?.cellByActorId[residentId], 'S');
  const eventPayloads = (result.event.payload as { dungeonEvents: readonly { kind: string; payload: { event?: string } }[] }).dungeonEvents;
  const event = eventPayloads.find(({ kind }) => kind === 'dungeon-cell-event');
  assert.ok(event);
  assert.notEqual(event.payload.event, '火山彈');
});

test('each branch start cell can exit the dungeon back to volcano Node 21', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'dungeon-three-branch-exits', contentVersion: 'archive-01669CAC' });
  for (const cellId of ['A1', 'B1', 'C1']) {
    const residentId = 'resident-01';
    const tripId = `exit-${cellId}`;
    const actors = Object.fromEntries(Object.values(initial.actors).map((value) => [value.id, { ...value, nextActionAtT: 100 }]));
    const actor = { ...initial.actors[residentId]!, nodeId: '21', nextActionAtT: 0, dungeonLocation: { tripId, floor: 1, cellId } };
    const state = { ...initial, actors: { ...actors, [residentId]: actor }, dungeonRuntime: { schemaVersion: 1 as const, tripId, activeFloor: 1, cellByActorId: { [residentId]: cellId }, unlockedFloorByActorId: { [residentId]: 1 }, visitedCells: [`1:${cellId}`], activeEncounterByCell: {} } };
    const exit = availableActions(state, residentId, graph, undefined, content).find(({ id }) => id === `dungeon-exit:${cellId}`);
    assert.ok(exit);
    assert.equal(exit.costT, 3);
    const result = settleNextAction(state, { actorId: residentId, actionId: exit.id, timeCostT: exit.costT, payload: exit.payload }, graph, undefined, content);
    assert.equal(result.ok, true, result.ok ? '' : result.unresolved.join('; '));
    if (!result.ok) continue;
    assert.equal(result.state.actors[residentId]?.nodeId, '21');
    assert.equal(result.state.actors[residentId]?.dungeonLocation, null);
    assert.equal(result.state.dungeonRuntime?.cellByActorId[residentId], undefined);
  }
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

test('placed scene objects are permanent, cannot be picked up, and can be destroyed while ordinary ground items stay pickable', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'placed-scene-object', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const actor = initial.actors[actorId];
  assert.ok(actor);
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, resident.id === actorId
      ? { ...resident, nextActionAtT: 0 }
      : { ...resident, nextActionAtT: 100 }])),
    objects: {
      ...initial.objects,
      placed_sign: { id: 'placed_sign', itemId: '告示牌', objectType: 'item' as const, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: 0, expiresAtT: null, unique: false, provisional: false, placed: true },
      ordinary_item: { id: 'ordinary_item', itemId: '普通魚', objectType: 'item' as const, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: 0, expiresAtT: 72, unique: false, provisional: false },
    },
  };
  const actions = availableActions(state, actorId, graph);
  assert.equal(actions.some(({ type, payload }) => type === 'pickup' && JSON.stringify(payload) === JSON.stringify({ objectId: 'placed_sign' })), false);
  assert.ok(actions.some(({ type, payload }) => type === 'pickup' && JSON.stringify(payload) === JSON.stringify({ objectId: 'ordinary_item' })));
  const destroy = actions.find(({ id }) => id === 'destroy-placed:placed_sign');
  assert.ok(destroy);
  assert.equal(destroy.costT, 1);
  const destroyed = settleNextAction(state, { actorId, actionId: destroy.id, timeCostT: destroy.costT, payload: destroy.payload }, graph);
  assert.equal(destroyed.ok, true, destroyed.ok ? '' : destroyed.unresolved.join('; '));
  if (!destroyed.ok) return;
  assert.equal(destroyed.state.objects.placed_sign, undefined);
  assert.ok(destroyed.state.objects.ordinary_item);
});

test('the default central campfire is a permanent placed object and is not pickable', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'placed-campfire', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, resident.id === actorId
      ? { ...resident, nodeId: '25', inventory: ['營火'], nextActionAtT: 0 }
      : { ...resident, nextActionAtT: 100 }])),
  };
  const actions = availableActions(state, actorId, graph);
  assert.equal(actions.some(({ type, payload }) => type === 'pickup' && JSON.stringify(payload) === JSON.stringify({ objectId: 'default-campfire-node-25' })), false);
  const fire = state.objects['default-campfire-node-25'];
  assert.ok(fire);
  assert.equal(fire.lit, true);
  assert.equal(fire.placed, true);
  assert.equal(fire.expiresAtT, null);
  assert.ok(actions.some(({ id }) => id === `destroy-placed:${fire.id}`));
});

test('drops non-unique inventory items with 72T expiry, including coconuts, and keeps unique hero equipment', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'drop-action', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const nodeId = initial.actors[actorId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor, nextActionAtT: actor.id === actorId ? 0 : 100,
      ...(actor.id === actorId ? { inventory: ['普通魚', '勇者劍', '椰子'] } : {}),
    }])),
  };
  const drop = availableActions(state, actorId, graph).find(({ id }) => id === 'drop:普通魚');
  assert.ok(drop);
  assert.equal(drop.costT, 1);
  const result = settleNextAction(state, { actorId, actionId: drop.id, timeCostT: 1, payload: drop.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const dropped = Object.values(result.state.objects).find(({ itemId }) => itemId === '普通魚');
  assert.equal(dropped?.generatedAtT, 0);
  assert.equal(dropped?.expiresAtT, 72);
  assert.deepEqual(result.state.actors[actorId]?.inventory, ['勇者劍', '椰子']);
  const coconutDrop = availableActions(result.state, actorId, graph).find(({ id }) => id === 'drop:椰子');
  assert.ok(coconutDrop);
  if (!coconutDrop) return;
  const droppedCoconut = settleNextAction(result.state, { actorId, actionId: coconutDrop.id, timeCostT: 1, payload: coconutDrop.payload }, graph);
  assert.equal(droppedCoconut.ok, true);
  if (!droppedCoconut.ok) return;
  const coconutObject = Object.values(droppedCoconut.state.objects).find(({ itemId }) => itemId === '椰子');
  assert.equal(coconutObject?.generatedAtT, 1);
  assert.equal(coconutObject?.expiresAtT, 73);
  assert.equal((droppedCoconut.state.actors[actorId]?.inventory ?? []).includes('椰子'), false);
  const uniqueDrop = availableActions(result.state, actorId, graph).find(({ id }) => id === 'drop:勇者劍');
  assert.ok(uniqueDrop);
  const uniqueResult = settleNextAction(result.state, { actorId, actionId: uniqueDrop.id, timeCostT: 1, payload: uniqueDrop.payload }, graph);
  assert.equal(uniqueResult.ok, true);
  if (!uniqueResult.ok) return;
  const heroSword = Object.values(uniqueResult.state.objects).find(({ itemId }) => itemId === '勇者劍');
  assert.equal(heroSword?.unique, true);
  assert.equal(heroSword?.expiresAtT, null);
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

test('surface rewards honor unique equipment held by any resident', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'global-unique-surface-reward', contentVersion: 'archive-01669CAC' });
  const content = await loadSimulationActionContent(sourceTables);
  const actorId = 'resident-01';
  const otherId = 'resident-02';
  const rngState = Array.from({ length: 100_000 }, (_, index) => (index + 1).toString(16).padStart(8, '0')).find((candidate) => {
    const probe = settleNextAction({
      ...initial,
      rngState: candidate,
      actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
        ...actor, nodeId: actor.id === actorId ? '2' : null, nextActionAtT: actor.id === actorId ? 0 : 100,
      }])),
    }, { actorId, actionId: 'surface:fishing', timeCostT: 3, payload: { surfaceAction: 'fishing' } }, graph, undefined, content);
    return probe.ok && (probe.event.payload as { outcome?: string }).outcome === '勇者下甲';
  });
  assert.ok(rngState !== undefined);
  const state = {
    ...initial,
    rngState,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor,
      nodeId: actor.id === actorId || actor.id === otherId ? '2' : null,
      nextActionAtT: actor.id === actorId ? 0 : 100,
      ...(actor.id === otherId ? { inventory: ['勇者下甲'] } : {}),
    }])),
  };
  const result = settleNextAction(state, {
    actorId, actionId: 'surface:fishing', timeCostT: 3, payload: { surfaceAction: 'fishing' },
  }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state.actors[actorId]?.inventory, []);
  assert.equal(Object.values(result.state.objects).some(({ itemId, unique }) => itemId === '勇者下甲' && unique), false);
  assert.equal((result.event.payload as { uniqueItemAlreadyExists?: boolean }).uniqueItemAlreadyExists, true);
});

test('atomically gifts a unique hero item and updates its owner ledger', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'gift-unique-equipment', contentVersion: 'archive-01669CAC' });
  const giverId = 'resident-01';
  const recipientId = 'resident-02';
  const nodeId = initial.actors[giverId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor,
      nodeId: actor.id === giverId || actor.id === recipientId ? nodeId : null,
      nextActionAtT: actor.id === giverId ? 0 : 100,
      ...(actor.id === giverId ? { inventory: ['勇者劍'] } : {}),
    }])),
  };
  const gift = availableActions(state, giverId, graph).find(({ id }) => id === `gift:${recipientId}:勇者劍`);
  assert.ok(gift);
  const result = settleNextAction(state, { actorId: giverId, actionId: gift.id, timeCostT: 1, payload: gift.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state.actors[giverId]?.inventory, []);
  assert.deepEqual(result.state.actors[recipientId]?.inventory, ['勇者劍']);
  assert.equal(result.state.uniqueOwnerByItemId?.['勇者劍'], recipientId);
  assert.equal(result.event.kind, 'gift-transferred');
});

test('trade actions are disabled while drop and public messages remain legal', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'trade-disabled', contentVersion: 'archive-01669CAC' });
  const proposerId = 'resident-01';
  const receiverId = 'resident-02';
  const nodeId = initial.actors[proposerId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }])) ,
      [proposerId]: { ...initial.actors[proposerId]!, nodeId, nextActionAtT: 0, inventory: ['普通魚'] },
      [receiverId]: { ...initial.actors[receiverId]!, nodeId, nextActionAtT: 100, inventory: ['勇者劍'] },
    },
  };
  const actions = availableActions(state, proposerId, graph, undefined, content);
  const message = actions.find(({ id }) => id === `message:${receiverId}`);
  const drop = actions.find(({ id }) => id === 'drop:普通魚');
  assert.ok(message);
  assert.ok(drop);
  assert.equal(actions.some(({ type }) => type === 'trade-request' || type === 'trade-response'), false);

  const forgedRequest = settleNextAction(state, {
    actorId: proposerId, actionId: `trade-request:${receiverId}:普通魚`, timeCostT: 1,
    payload: { receiverActorId: receiverId, offeredItemId: '普通魚' }, text: '勇者劍',
  }, graph, undefined, content);
  assert.equal(forgedRequest.ok, false);
  if (!forgedRequest.ok) assert.match(forgedRequest.unresolved.join(' '), /not currently legal/);
  assert.equal(forgedRequest.state, state);

  const sent = settleNextAction(state, {
    actorId: proposerId, actionId: message.id, timeCostT: 1, payload: message.payload, text: '測試訊息',
  }, graph);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.event.kind, 'public-message-sent');
  const dropAfterMessage = availableActions(sent.state, proposerId, graph).find(({ id }) => id === 'drop:普通魚');
  assert.ok(dropAfterMessage);
  const dropped = settleNextAction(sent.state, {
    actorId: proposerId, actionId: dropAfterMessage.id, timeCostT: 1, payload: dropAfterMessage.payload,
  }, graph);
  assert.equal(dropped.ok, true);
  if (dropped.ok) {
    assert.equal(dropped.event.kind, 'item-dropped');
    assert.deepEqual(dropped.state.actors[proposerId]?.inventory, []);
  }

  const offerId = 'legacy-pending-offer';
  const responseState = {
    ...state,
    actors: {
      ...state.actors,
      [proposerId]: { ...state.actors[proposerId]!, nextActionAtT: 100 },
      [receiverId]: { ...state.actors[receiverId]!, nextActionAtT: 0 },
    },
    pendingTradeOffers: { [offerId]: { offerId, proposerId, receiverId, nodeId, offeredItemId: '普通魚', requestedItemId: '勇者劍', createdAtT: 0, status: 'pending' as const } },
  };
  assert.equal(availableActions(responseState, receiverId, graph).some(({ type }) => type === 'trade-response'), false);
  const forgedResponse = settleNextAction(responseState, {
    actorId: receiverId, actionId: `trade-response:${offerId}:accept`, timeCostT: 1,
    payload: { offerId, decision: 'accept' },
  }, graph);
  assert.equal(forgedResponse.ok, false);
  assert.equal(forgedResponse.state, responseState);
  assert.deepEqual(forgedResponse.state.actors[proposerId]?.inventory, ['普通魚']);
  assert.deepEqual(forgedResponse.state.actors[receiverId]?.inventory, ['勇者劍']);
  assert.equal(forgedResponse.state.pendingTradeOffers?.[offerId]?.status, 'pending');
});

test('last hitter receives the source-defined dragon blood ten-HP healing on lethal strike', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'dragon-blood-last-hit', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: actor.id === residentId ? nodeId : null, nextActionAtT: 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 0, attack: 15, hitPoints: 20 },
      dragon: { id: 'dragon', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 3, unsafeEntryAtT: 0, sleeping: false, hitPoints: 1, defense: 0, name: '巨龍' },
    } as typeof initial.actors,
  };
  const attack = availableActions(state, residentId, graph).find(({ id }) => id === 'attack:dragon');
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[residentId]?.hitPoints, 30);
  assert.equal(result.state.actors.dragon?.alive, false);
  assert.equal((result.event.payload as { dragonBloodHealing?: number }).dragonBloodHealing, 10);
});

test('fire lizard returns the unique hero sword only when no recoverable copy exists', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'fire-lizard-unique-sword', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: actor.id === residentId ? nodeId : null, nextActionAtT: 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 0, attack: 15, inventory: ['普通魚', '名鮭魚', '肉', '椰子', '普通魚', '名鮭魚', '肉', '椰子', '普通魚', '名鮭魚'] },
      'fire-lizard': { id: 'fire-lizard', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 1, defense: 0, attack: 0, name: '火蜥蜴' },
    } as typeof initial.actors,
  };
  const attack = availableActions(state, residentId, graph).find(({ id }) => id === 'attack:fire-lizard');
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const sword = Object.values(result.state.objects).find((object) => object.itemId === '勇者劍');
  assert.ok(sword);
  assert.equal(sword.unique, true);
  assert.equal(sword.expiresAtT, null);
  assert.equal((result.event.payload as { uniqueHeroItemId?: string }).uniqueHeroItemId, '勇者劍');
});

test('fire lizard gives the unique hero sword to the last hitter when there is inventory space', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'fire-lizard-sword-inventory', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: actor.id === residentId ? nodeId : null, nextActionAtT: 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 0, attack: 15, inventory: ['普通魚'] },
      'fire-lizard': { id: 'fire-lizard', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 1, defense: 0, attack: 0, name: '火蜥蜴' },
    } as typeof initial.actors,
  };
  const attack = availableActions(state, residentId, graph).find(({ id }) => id === 'attack:fire-lizard');
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state.actors[residentId]?.inventory, ['普通魚', '勇者劍']);
  assert.equal(result.state.uniqueOwnerByItemId?.['勇者劍'], residentId);
  assert.equal(Object.values(result.state.objects).some((object) => object.itemId === '勇者劍'), false);
});

test('fire lizard does not duplicate a recoverable unique hero sword', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'fire-lizard-sword-already-held', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const existingOwnerId = 'resident-02';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: actor.id === residentId ? nodeId : null, nextActionAtT: 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 0, attack: 15, inventory: ['普通魚'] },
      [existingOwnerId]: { ...initial.actors[existingOwnerId]!, nodeId: null, inventory: ['勇者劍'] },
      'fire-lizard': { id: 'fire-lizard', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 1, defense: 0, attack: 0, name: '火蜥蜴' },
    } as typeof initial.actors,
  };
  const attack = availableActions(state, residentId, graph).find(({ id }) => id === 'attack:fire-lizard');
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[residentId]?.inventory?.includes('勇者劍'), false);
  assert.deepEqual(result.state.actors[existingOwnerId]?.inventory, ['勇者劍']);
  assert.equal((result.event.payload as { uniqueHeroItemId?: string }).uniqueHeroItemId, undefined);
  assert.equal(Object.values(result.state.objects).some((object) => object.itemId === '勇者劍'), false);
});

test('settles a public short message as a 1T event without locking the recipient', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'public-message-action', contentVersion: 'archive-01669CAC' });
  const senderId = 'resident-01';
  const recipientId = 'resident-02';
  const nodeId = initial.actors[senderId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }])),
      [senderId]: { ...initial.actors[senderId]!, nodeId, nextActionAtT: 0 },
      [recipientId]: { ...initial.actors[recipientId]!, nodeId, nextActionAtT: 0 },
    },
  };
  const message = availableActions(state, senderId, graph).find(({ id }) => id === `message:${recipientId}`);
  assert.ok(message);
  assert.equal(message.costT, 1);
  assert.equal(message.requiresText, true);
  const result = settleNextAction(state, { actorId: senderId, actionId: message.id, timeCostT: 1, payload: message.payload, text: '一起去河邊嗎？' }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[senderId]?.nextActionAtT, 1);
  assert.equal(result.state.actors[recipientId]?.nextActionAtT, 0);
  assert.equal(result.event.kind, 'public-message-sent');
  assert.deepEqual(result.event.payload, { recipientId, text: '一起去河邊嗎？' });
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
  assert.equal(result.state.actors[attackerId]?.nextActionAtT, 1);
  assert.equal(orderNextResidents(result.state).actionTimeT, 1);
  assert.deepEqual(orderNextResidents(result.state).actorIds, [attackerId]);
  assert.equal(result.state.actors[targetId]?.hitPoints, 4);
  assert.equal(result.event.kind, 'resident-attacked');
  assert.equal((result.event.payload as { damage: number }).damage, 4);
});

test('lets a resident choose and settle a legal attack against a spawned same-Node monster', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'attack-spawned-monster', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: actor.id === residentId ? 0 : 100 }])),
      'monster-spawned': {
        id: 'monster-spawned', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 2,
        unsafeEntryAtT: 0, sleeping: false, hitPoints: 8, defense: 1, attack: 0, name: '森林野豬', travel: null,
      },
    } as typeof initial.actors,
  };
  const actor = state.actors[residentId];
  assert.ok(actor);
  const equippedActor = { ...actor, attack: 3 };
  const attackState = { ...state, actors: { ...state.actors, [residentId]: equippedActor } };
  const attack = availableActions(attackState, residentId, graph).find(({ id }) => id === 'attack:monster-spawned');
  assert.ok(attack);
  const result = settleNextAction(attackState, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors['monster-spawned']?.hitPoints, 6);
  assert.equal((result.event.payload as { targetType: string }).targetType, 'monster');
});

test('awards a source-row monster drop to the last hitter or materializes it when inventory is full', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const rewardSeed = Array.from({ length: 500 }, (_, index) => (index + 1).toString(16).padStart(8, '0'))
    .find((seed) => new SeededRandom(seed).next('monster.bonus-drop.巨蟒').value < 0.35);
  assert.ok(rewardSeed);
  const initial = createInitialWorld(graph, { seed: 'monster-drop', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    rngState: rewardSeed,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: actor.id === residentId ? 0 : 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 0, attack: 5, inventory: Array.from({ length: 10 }, (_, index) => `item-${index}`) },
      'monster-loot-target': { id: 'monster-loot-target', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 1, unsafeEntryAtT: 0, sleeping: false, hitPoints: 1, defense: 0, attack: 0, name: '巨蟒' },
    } as typeof initial.actors,
  };
  const attack = availableActions(state, residentId, graph).find(({ id }) => id === 'attack:monster-loot-target');
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const payload = result.event.payload as { rewardItemId?: string; rewardObjectId?: string };
  assert.ok(['紙筆', '告示牌'].includes(payload.rewardItemId ?? ''));
  const drop = Object.values(result.state.objects).find(({ itemId }) => itemId === payload.rewardItemId);
  assert.equal(drop?.nodeId, nodeId);
  assert.equal(drop?.expiresAtT, 72);
  assert.equal(result.state.actors[residentId]?.inventory?.length, 10);
  assert.equal(payload.rewardObjectId, drop?.id);
  assert.equal(result.randomDraws.at(-1)?.sourceId, 'monster.bonus-drop.巨蟒');
});

test('delivers a source-row monster drop to the last hitter when an inventory slot is available', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const rewardSeed = Array.from({ length: 500 }, (_, index) => (index + 1).toString(16).padStart(8, '0'))
    .find((seed) => new SeededRandom(seed).next('monster.bonus-drop.巨蟒').value < 0.35);
  assert.ok(rewardSeed);
  const initial = createInitialWorld(graph, { seed: 'monster-drop-inventory', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    rngState: rewardSeed,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: actor.id === residentId ? 0 : 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 0, attack: 5, inventory: [] },
      'monster-loot-target': { id: 'monster-loot-target', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 1, unsafeEntryAtT: 0, sleeping: false, hitPoints: 1, defense: 0, attack: 0, name: '巨蟒' },
    } as typeof initial.actors,
  };
  const attack = availableActions(state, residentId, graph).find(({ id }) => id === 'attack:monster-loot-target');
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const item = (result.event.payload as { rewardItemId?: string }).rewardItemId;
  assert.ok(['紙筆', '告示牌'].includes(item ?? ''));
  assert.equal(result.state.actors[residentId]?.inventory?.at(-1), item);
  assert.equal(Object.values(result.state.objects).some(({ itemId }) => itemId === item), false);
});

test('resolves lethal lava-slime reflection in the same resident attack settlement', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'slime-reflection-atomic', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: actor.id === residentId ? 0 : 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 0, attack: 6, defense: 1, hitPoints: 20 },
      'lava-slime': { id: 'lava-slime', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 1, unsafeEntryAtT: 0, sleeping: false, hitPoints: 2, defense: 1, attack: 0, name: '熔岩史萊姆' },
  } as typeof initial.actors,
  };
  const attack = availableActions(state, residentId, graph).find(({ id }) => id === 'attack:lava-slime');
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors['lava-slime']?.alive, false);
  const hitPointsAfter = result.state.actors[residentId]?.hitPoints ?? 0;
  assert.ok(hitPointsAfter >= 11 && hitPointsAfter <= 13);
  const payload = result.event.payload as { damage: number; reflectionRawDamage?: number; reflectionDamage?: number; reflectionOnLethalHit?: boolean };
  assert.equal(payload.damage, 5);
  assert.ok([8, 9, 10].includes(payload.reflectionRawDamage ?? -1));
  assert.ok([7, 8, 9].includes(payload.reflectionDamage ?? -1));
  assert.equal(payload.reflectionOnLethalHit, true);
  assert.deepEqual(result.randomDraws.map(({ sourceId }) => sourceId), [
    'monster-reflection.1.lava-slime.reflection', 'monster.bonus-drop.熔岩史萊姆',
  ]);
});

test('lethal lava-slime reflection creates the resident corpse and keeps biography pending', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'slime-reflection-death', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: actor.id === residentId ? 0 : 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 0, attack: 6, defense: 1, hitPoints: 7 },
      'lava-slime': { id: 'lava-slime', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 1, unsafeEntryAtT: 0, sleeping: false, hitPoints: 2, defense: 1, attack: 0, name: '熔岩史萊姆' },
    } as typeof initial.actors,
  };
  const attack = availableActions(state, residentId, graph).find(({ id }) => id === 'attack:lava-slime');
  assert.ok(attack);
  const result = settleNextAction(state, { actorId: residentId, actionId: attack.id, timeCostT: 1, payload: attack.payload, intent: '守住營地' }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[residentId]?.alive, false);
  assert.equal(result.state.actors[residentId]?.hitPoints, 0);
  assert.deepEqual(result.state.privateLifeData?.[residentId], { intents: ['守住營地'], biographyStatus: 'pending' });
  assert.ok(Object.values(result.state.objects).some(({ objectType, remainsActorId }) => objectType === 'corpse' && remainsActorId === residentId));
});

test('settles both fire-wing bat strikes independently through the world event queue', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'fire-wing-double-hit', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: actor.id === residentId ? nodeId : null, nextActionAtT: 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 100, hitPoints: 30, defense: 0 },
      'fire-wing-bat': { id: 'fire-wing-bat', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 0, speed: 5, unsafeEntryAtT: 0, sleeping: false, hitPoints: 18, defense: 1, attack: 0, name: '火翼蝙蝠' },
    } as typeof initial.actors,
  };
  const result = settleNextTimerEvent(state, {}, { monsters: content.monsters, attackDistributions: content.attackDistributions });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'monster-action-settled');
  const payload = result.event.payload as { action: string; hits: readonly { targetId: string; appliedDamage: number }[] };
  assert.equal(payload.action, 'attack');
  assert.equal(payload.hits.length, 2);
  assert.deepEqual(payload.hits.map(({ targetId }) => targetId), [residentId, residentId]);
  assert.equal(result.randomDraws.length, 4);
  assert.equal(result.state.actors[residentId]?.hitPoints, 30 - payload.hits.reduce((sum, hit) => sum + hit.appliedDamage, 0));
});

test('green dwarf summon creates at most one non-chaining companion for an encounter', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'green-dwarf-summon', contentVersion: 'archive-01669CAC' });
  const residentId = 'resident-01';
  const monsterId = 'green-dwarf';
  const nodeId = initial.actors[residentId]?.nodeId;
  assert.ok(nodeId);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }])),
      [residentId]: { ...initial.actors[residentId]!, nodeId, nextActionAtT: 0, attack: 3 },
      [monsterId]: { id: monsterId, actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 3, unsafeEntryAtT: 0, sleeping: false, hitPoints: 4, maxHitPoints: 8, defense: 1, attack: 0, name: '綠矮人', encounterId: 'encounter-a' },
    } as typeof initial.actors,
  };
  const action = availableActions(state, residentId, graph).find(({ id }) => id === `attack:${monsterId}`);
  assert.ok(action);
  const result = settleNextAction(state, { actorId: residentId, actionId: action.id, timeCostT: 1, payload: action.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const companions = Object.values(result.state.actors).filter((actor) => actor.actorType === 'monster' && actor.encounterId === 'encounter-a' && actor.isSummonedCompanion);
  assert.equal(companions.length, 1);
  assert.equal(companions[0]?.hitPoints, 8);
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

test('keeps a moving resident outside both Nodes until the 3T arrival timer', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'integration-run', contentVersion: 'archive-01669CAC' });
  const state = { ...initial, actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, alive: actor.id === 'resident-01', nodeId: actor.id === 'resident-01' ? actor.nodeId : null, nextActionAtT: actor.id === 'resident-01' ? 0 : 100 }])) };
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  store.commit(0, state, []);
  const schedule = orderNextResidents(state);
  assert.equal(schedule.actionTimeT, 0);
  const actorId = schedule.actorIds[0];
  assert.ok(actorId);
  const actions = availableActions(state, actorId, graph);
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
  assert.equal(result.state.actors[actorId]?.travel?.fromNodeId, initial.actors[actorId]?.nodeId);
  assert.equal(result.state.actors[actorId]?.travel?.toNodeId, targetNodeId);
  assert.equal(result.state.actors[actorId]?.travel?.arrivesAtT, 3);
  assert.equal(store.readSnapshot()?.actors[actorId]?.nodeId, null);
  assert.equal(store.readEvents().length, 1);
  assert.equal(nextWorldEvent(result.state).kind, 'travel-arrival');
  const arrival = settleNextTimerEvent(result.state);
  assert.equal(arrival.ok, true);
  if (!arrival.ok) return;
  assert.equal(arrival.event.kind, 'resident-arrived');
  assert.equal(arrival.state.worldTimeT, 3);
  assert.equal(arrival.state.actors[actorId]?.nodeId, targetNodeId);
  assert.equal(arrival.state.actors[actorId]?.travel, null);
  assert.equal(nextWorldEvent(arrival.state).kind, 'resident-action');
  store.close();
});

test('a target-Node monster cannot attack a resident while the resident is in transit', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'transit-no-target', contentVersion: 'archive-01669CAC' });
  const content = await loadSimulationActionContent(sourceTables);
  const actorId = 'resident-01';
  const fromNodeId = initial.actors[actorId]!.nodeId!;
  const edge = graph.edges.find(({ source, target }) => source === fromNodeId || target === fromNodeId)!;
  const targetNodeId = edge.source === fromNodeId ? edge.target : edge.source;
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, alive: actor.id === actorId || actor.id === 'resident-02', nodeId: actor.id === actorId ? fromNodeId : actor.id === 'resident-02' ? targetNodeId : null, nextActionAtT: actor.id === actorId ? 0 : actor.id === 'resident-02' ? 100 : 100 }])),
      wolf: { id: 'wolf', actorType: 'monster' as const, alive: true, nodeId: targetNodeId, nextActionAtT: 1, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 8, attack: 4, defense: 0, name: '夜狼', travel: null },
    },
  };
  const move = availableActions(state, actorId, graph).find(({ id }) => id === `move:${targetNodeId}`);
  assert.ok(move);
  const departed = settleNextAction(state, { actorId, actionId: move.id, timeCostT: 3, payload: move.payload }, graph);
  assert.equal(departed.ok, true);
  if (!departed.ok) return;
  assert.equal(departed.state.actors[actorId]?.nodeId, null);
  const attack = settleNextTimerEvent(departed.state, {}, { monsters: content.monsters, attackDistributions: content.attackDistributions });
  assert.equal(attack.ok, true, attack.ok ? '' : attack.unresolved.join('; '));
  if (!attack.ok) return;
  assert.equal(attack.event.kind, 'monster-action-settled');
  assert.equal((attack.event.payload as { hits: readonly { targetId: string }[] }).hits.some(({ targetId }) => targetId === actorId), false);
  assert.equal(attack.state.actors[actorId]?.hitPoints, departed.state.actors[actorId]?.hitPoints);
  assert.equal(attack.state.actors[actorId]?.nodeId, null);
});

test('leaving the last player clears hostile and huntable actors but preserves ground objects', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'clear-empty-node-actors', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const secondId = 'resident-02';
  const fromNodeId = '1';
  const toNodeId = graph.edges.find(({ source, target }) => source === fromNodeId || target === fromNodeId);
  assert.ok(toNodeId);
  const target = toNodeId.source === fromNodeId ? toNodeId.target : toNodeId.source;
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, alive: actor.id === actorId || actor.id === secondId, nodeId: actor.id === actorId || actor.id === secondId ? fromNodeId : null, nextActionAtT: actor.id === actorId ? 0 : actor.id === secondId ? 3 : 100 }])),
      boar: { id: 'boar', actorType: 'animal' as const, alive: true, nodeId: fromNodeId, nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, name: '森林野豬' },
      enemy: { id: 'enemy', actorType: 'monster' as const, alive: true, nodeId: fromNodeId, nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 5, defense: 0, name: '夜狼' },
    },
    objects: { ...initial.objects, pickup: { id: 'pickup', itemId: '椰子', objectType: 'item' as const, ownerActorId: null, nodeId: fromNodeId, generatedAtT: 0, expiresAtT: 72, unique: false, provisional: false } },
  };
  const move = availableActions(state, actorId, graph).find(({ id }) => id === `move:${target}`);
  assert.ok(move);
  const result = settleNextAction(state, { actorId, actionId: move.id, timeCostT: move.costT, payload: move.payload }, graph);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors.boar?.alive, true);
  assert.equal(result.state.actors.enemy?.alive, true);
  const secondDepartureState = { ...result.state, actors: {
    ...result.state.actors,
    [actorId]: { ...result.state.actors[actorId]!, nextActionAtT: 100 },
    [secondId]: { ...result.state.actors[secondId]!, nextActionAtT: 0 },
  } };
  const secondMove = availableActions(secondDepartureState, secondId, graph).find(({ id }) => id === `move:${target}`);
  assert.ok(secondMove);
  const finalDeparture = settleNextAction(secondDepartureState, { actorId: secondId, actionId: secondMove.id, timeCostT: secondMove.costT, payload: secondMove.payload }, graph);
  assert.equal(finalDeparture.ok, true);
  if (!finalDeparture.ok) return;
  assert.equal(finalDeparture.state.actors.boar, undefined);
  assert.equal(finalDeparture.state.actors.enemy, undefined);
  assert.equal(finalDeparture.state.objects.pickup?.nodeId, fromNodeId);
});

test('entering a Node with another player suppresses both night and terrain entry checks', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'occupied-node-entry', contentVersion: 'archive-01669CAC' });
  const content = await loadSimulationActionContent(sourceTables);
  const actorId = 'resident-01';
  const otherId = 'resident-02';
  const targetNodeId = '9';
  const edge = graph.edges.find(({ source, target }) => source === targetNodeId || target === targetNodeId);
  assert.ok(edge);
  const fromNodeId = edge.source === targetNodeId ? edge.target : edge.source;
  const targetNode = { ...initial.nodes[targetNodeId]!, surfaceTerrain: 'forest' as const };
  const encounterSeed = Array.from({ length: 500 }, (_, index) => (index + 1).toString(16).padStart(8, '0'))
    .find((candidate) => resolveNightEncounterCheck({ node: targetNode, actorId, worldTimeT: 48, randomState: candidate }).encounter);
  assert.ok(encounterSeed);
  const state = {
    ...initial, worldTimeT: 48, rngState: encounterSeed,
    nodes: { ...initial.nodes, [targetNodeId]: targetNode },
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor,
      alive: actor.id === actorId || actor.id === otherId,
      nodeId: actor.id === actorId ? fromNodeId : actor.id === otherId ? targetNodeId : null,
      nextActionAtT: actor.id === actorId ? 48 : 100,
    }])),
  };
  const move = availableActions(state, actorId, graph, undefined, content).find(({ id }) => id === `move:${targetNodeId}`);
  assert.ok(move);
  const result = settleNextAction(state, { actorId, actionId: move.id, timeCostT: move.costT, payload: move.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const payload = result.event.payload as { nightEncounter?: unknown; surfaceEntry?: unknown };
  assert.equal(payload.nightEncounter, undefined);
  assert.equal(payload.surfaceEntry, undefined);
  assert.equal(result.state.actors[actorId]?.hitPoints, state.actors[actorId]?.hitPoints);
});

test('resident death that empties a Node clears creatures and leaves ground objects', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'death-empties-node', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const nodeId = initial.actors[actorId]!.nodeId!;
  const state = {
    ...initial,
    worldTimeT: 71,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
        ...actor,
        alive: actor.id === actorId,
        nodeId: actor.id === actorId ? nodeId : null,
        nextActionAtT: 100,
        ...(actor.id === actorId ? { hunger: 0, sleep: 0, hitPoints: 1 } : {}),
      }])),
      enemy: { id: 'enemy', actorType: 'monster' as const, alive: true, nodeId, nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 5, defense: 0, name: '夜狼' },
    },
    objects: { ...initial.objects, pickup: { id: 'pickup', itemId: '椰子', objectType: 'item' as const, ownerActorId: null, nodeId, generatedAtT: 0, expiresAtT: 100, unique: false, provisional: false } },
  };
  const result = settleNextTimerEvent(state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[actorId]?.alive, false);
  assert.equal(result.state.actors.enemy, undefined);
  assert.equal(result.state.objects.pickup?.nodeId, nodeId);
});

test('records the prior route and retreats along it in reverse without adding a new route loop', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'retreat-route-history', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  let state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor,
      nodeId: actor.id === actorId ? '1' : actor.nodeId,
      nextActionAtT: actor.id === actorId ? 0 : 100,
    }])),
  };

  for (const [toNodeId, expectedRoute] of [['2', ['1']], ['3', ['1', '2']]] as const) {
    const move = availableActions(state, actorId, graph).find((action) => action.id === `move:${toNodeId}`);
    assert.ok(move);
    const result = settleNextAction(state, { actorId, actionId: move.id, timeCostT: move.costT, payload: move.payload }, graph);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const arrival = settleNextTimerEvent(result.state);
    assert.equal(arrival.ok, true);
    if (!arrival.ok) return;
    state = arrival.state;
    assert.equal(state.actors[actorId]?.nodeId, toNodeId);
    assert.deepEqual(state.actors[actorId]?.routeHistory, expectedRoute);
  }

  for (const [toNodeId, expectedRoute, currentNodeId] of [['2', ['1'], '3'], ['1', [], '2']] as const) {
    const monsterId = `route-monster-${currentNodeId}`;
    state = {
      ...state,
      actors: {
        ...state.actors,
        [monsterId]: { id: monsterId, actorType: 'monster', alive: true, nodeId: currentNodeId, nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 5, defense: 0, attack: 0, name: '森林野豬' },
      },
    };
    const retreat = availableActions(state, actorId, graph).find((action) => action.id === `retreat:${toNodeId}`);
    assert.ok(retreat);
    assert.equal(retreat.costT, 3);
    const result = settleNextAction(state, { actorId, actionId: retreat.id, timeCostT: retreat.costT, payload: retreat.payload }, graph);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const arrival = settleNextTimerEvent(result.state);
    assert.equal(arrival.ok, true);
    if (!arrival.ok) return;
    state = arrival.state;
    assert.equal(state.actors[actorId]?.nodeId, toNodeId);
    assert.deepEqual(state.actors[actorId]?.routeHistory, expectedRoute);
  }
  assert.deepEqual(availableActions(state, actorId, graph).filter(({ type }) => type === 'retreat'), []);
});

test('leaving a dungeon Boss cell clears that Boss only after the last resident leaves, then re-entry respawns it', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'boss-cell-occupancy', contentVersion: 'archive-01669CAC' });
  const content = await loadSimulationActionContent(sourceTables);
  const tripId = 'boss-cell-occupancy-trip';
  const residentIds = ['resident-01', 'resident-02', 'resident-03'] as const;
  const cellByActorId = { 'resident-01': 'E', 'resident-02': 'E', 'resident-03': 'B1' };
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, alive: residentIds.includes(actor.id as typeof residentIds[number]), nodeId: residentIds.includes(actor.id as typeof residentIds[number]) ? '21' : null, ...(actor.id === 'resident-02' ? { hitPoints: 20 } : {}), nextActionAtT: actor.id === 'resident-01' || actor.id === 'resident-02' ? 0 : 100 }]));
  for (const residentId of residentIds) {
    const cellId = cellByActorId[residentId];
    actors[residentId] = { ...actors[residentId]!, dungeonLocation: { tripId, floor: 1, cellId }, dungeonRouteHistory: cellId === 'E' ? ['A2'] : ['S'] };
  }
  const bossId = `boss-${tripId}-floor-1`;
  const otherCellBossId = 'boss-other-cell';
  actors[bossId] = { id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 100, speed: 3, unsafeEntryAtT: 0, travel: null, sleeping: false, hitPoints: 5, attack: 0, defense: 0, name: '大金剛鸚鵡', encounterId: tripId, dungeonLocation: { tripId, floor: 1, cellId: 'E' } };
  actors[otherCellBossId] = { ...actors[bossId]!, id: otherCellBossId, dungeonLocation: { tripId, floor: 1, cellId: 'B1' } };
  const state = {
    ...initial, actors,
    dungeonRuntime: { schemaVersion: 1 as const, tripId, activeFloor: 1, cellByActorId, unlockedFloorByActorId: { 'resident-01': 1, 'resident-02': 1, 'resident-03': 1 }, visitedCells: ['1:E', '1:A2', '1:B1'], activeEncounterByCell: {}, routeByActorId: { 'resident-01': ['A2'], 'resident-02': ['A2'], 'resident-03': ['S'] } },
  };
  let rngState = '00000001';
  const dungeonEvents = content.dungeonEvents ?? [];
  const nonMonsterSeed = Array.from({ length: 1000 }, (_, index) => (Math.imul(index + 1, 0x9e3779b9) >>> 0).toString(16).padStart(8, '0')).find((candidate) => {
    const draw = new SeededRandom(candidate);
    const event = resolveDungeonRuntimeStep({ state: state.dungeonRuntime!, actorId: 'resident-01', worldTimeT: 0, action: { kind: 'enter-cell', fromCellId: 'E', toCellId: 'A2', isBossCell: false, otherLivingResidentPresent: false, isRetreat: true }, events: dungeonEvents, random: draw, ids: { eventId: 'test-event', encounterId: 'test-encounter' } });
    return !event.eventDrafts.some(({ kind }) => kind === 'dungeon-encounter-started');
  });
  assert.ok(nonMonsterSeed);
  rngState = nonMonsterSeed;
  const ready = { ...state, rngState };
  const retreatFirst = availableActions(ready, 'resident-01', graph, undefined, content).find(({ id }) => id === 'dungeon-retreat:A2');
  assert.ok(retreatFirst);
  const first = settleNextAction(ready, { actorId: 'resident-01', actionId: retreatFirst.id, timeCostT: retreatFirst.costT, payload: retreatFirst.payload }, graph, undefined, content);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.state.actors[bossId]?.alive, true);
  assert.equal((first.event.payload as { dungeonEvents: readonly { kind: string }[] }).dungeonEvents.filter(({ kind }) => kind === 'dungeon-cell-event').length, 1);

  const retreatLast = availableActions(first.state, 'resident-02', graph, undefined, content).find(({ id }) => id === 'dungeon-retreat:A2');
  assert.ok(retreatLast);
  const last = settleNextAction(first.state, { actorId: 'resident-02', actionId: retreatLast.id, timeCostT: retreatLast.costT, payload: retreatLast.payload }, graph, undefined, content);
  assert.equal(last.ok, true, last.ok ? '' : last.unresolved.join('; '));
  if (!last.ok) return;
  assert.equal(last.state.actors[bossId], undefined);
  assert.equal(last.state.actors[otherCellBossId]?.alive, true);
  assert.equal((last.event.payload as { dungeonEvents: readonly { kind: string }[] }).dungeonEvents.filter(({ kind }) => kind === 'dungeon-cell-event').length, 0);

  const reenter = availableActions(last.state, 'resident-01', graph, undefined, content).find(({ id }) => id === 'dungeon-move:E');
  assert.ok(reenter);
  const entered = settleNextAction(last.state, { actorId: 'resident-01', actionId: reenter.id, timeCostT: reenter.costT, payload: reenter.payload }, graph, undefined, content);
  assert.equal(entered.ok, true);
  if (!entered.ok) return;
  assert.equal(entered.state.actors[bossId]?.alive, true);
  assert.ok((entered.state.actors[bossId]?.hitPoints ?? 0) > 5);
  assert.equal(entered.event.kind, 'dungeon-boss-encounter-started');
});

test('death of the last dungeon Boss-cell resident clears only that Boss without a victory transfer', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'boss-cell-last-death', contentVersion: 'archive-01669CAC' });
  const tripId = 'boss-cell-last-death-trip';
  const residentId = 'resident-01';
  const bossId = `boss-${tripId}-floor-1`;
  const actors: Record<string, WorldActor> = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
    ...actor, nextActionAtT: 100,
    ...(actor.id === residentId ? { nodeId: '21', hitPoints: 2, hunger: 0, sleep: 3, dungeonLocation: { tripId, floor: 1, cellId: 'E' } } : {}),
  }]));
  actors[bossId] = {
    id: bossId, actorType: 'monster', alive: true, nodeId: '21', nextActionAtT: 100, speed: 3,
    unsafeEntryAtT: 0, travel: null, sleeping: false, hitPoints: 13, attack: 0, defense: 0,
    name: '大金剛鸚鵡', encounterId: tripId, dungeonLocation: { tripId, floor: 1, cellId: 'E' },
  };
  const state = {
    ...initial,
    worldTimeT: 71,
    actors,
    dungeonRuntime: {
      schemaVersion: 1 as const, tripId, activeFloor: 1,
      cellByActorId: { [residentId]: 'E' }, unlockedFloorByActorId: { [residentId]: 1 },
      visitedCells: ['1:E'], activeEncounterByCell: {},
    },
  };
  assert.equal(nextWorldEvent(state).kind, 'day-boundary');
  const result = settleNextTimerEvent(state);
  assert.equal(result.ok, true, result.ok ? '' : result.unresolved.join('; '));
  if (!result.ok) return;
  assert.equal(result.state.actors[residentId]?.alive, false);
  assert.equal(result.state.actors[bossId], undefined);
  assert.equal(result.state.dungeonRuntime?.unlockedFloorByActorId[residentId], 1);
  assert.equal(result.state.dungeonRuntime?.activeFloor, 1);
  assert.equal(result.event.kind, 'daily-survival-settled');
  assert.equal(JSON.stringify(result.event.payload).includes('boss1-defeated'), false);
});

test('a wet-slippery-waterway slime blocks dungeon retreat but leaves ordinary interactions available', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'slime-blocks-retreat', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const tripId = 'slime-retreat-test';
  const dungeonLocation = { tripId, floor: 2 as const, cellId: 'E' };
  const slimeId = 'wet-slippery-waterway-slime';
  const currentContent = { ...content, readableTexts: { ...(content.readableTexts ?? {}), 'slime-test-sign': '測試告示牌' } };
  const containerSource = content.containerCategoryWeights?.[0]?.source;
  assert.ok(containerSource);
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }])),
      [actorId]: { ...initial.actors[actorId]!, nodeId: '21', nextActionAtT: 0, dungeonLocation, dungeonRouteHistory: ['A2'] },
      [slimeId]: { id: slimeId, actorType: 'monster' as const, alive: true, nodeId: '21', nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 16, defense: 1, attack: 0, name: '黏液怪', encounterId: 'wet-slippery-waterway', dungeonLocation },
    },
    objects: {
      ...initial.objects,
      sign: { id: 'sign', itemId: '告示牌', objectType: 'item' as const, readableTextId: 'slime-test-sign', ownerActorId: null, nodeId: '21', generatedAtT: 0, expiresAtT: null, unique: false, provisional: false, dungeonLocation },
      chest: { id: 'chest', itemId: '漂流背包', objectType: 'container' as const, ownerActorId: null, nodeId: '21', containerSourceId: containerSource, generatedAtT: 0, expiresAtT: 72, unique: false, provisional: false, dungeonLocation },
    },
    dungeonRuntime: {
      schemaVersion: 1 as const, tripId, activeFloor: 2 as const, cellByActorId: { [actorId]: 'E' },
      unlockedFloorByActorId: { [actorId]: 2 }, visitedCells: ['2:A2', '2:E'], activeEncounterByCell: {},
      routeByActorId: { [actorId]: ['A2'] },
    },
  };
  const actions = availableActions(state, actorId, graph, undefined, currentContent);
  assert.equal(actions.some(({ id }) => id === 'dungeon-retreat:A2'), false);
  assert.equal(actions.some(({ type }) => type === 'dungeon-move'), false);
  assert.equal(actions.some(({ id }) => id === `attack:${slimeId}`), true);
  assert.equal(actions.some(({ id }) => id === 'read:sign'), true);
  assert.equal(actions.some(({ id }) => id === 'container-open:chest'), true);
  const forged = settleNextAction(state, { actorId, actionId: 'dungeon-retreat:A2', timeCostT: 3, payload: { fromCellId: 'E', toCellId: 'A2' } }, graph, undefined, currentContent);
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.match(forged.unresolved[0] ?? '', /slime monster blocks retreat from this dungeon Cell/);
});

test('a living dungeon monster allows backward retreat while blocking forward movement', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'dungeon-monster-retreat', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const tripId = 'ordinary-dungeon-monster-retreat';
  const dungeonLocation = { tripId, floor: 1 as const, cellId: 'A2' };
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }])),
      [actorId]: { ...initial.actors[actorId]!, nodeId: '21', nextActionAtT: 0, dungeonLocation, dungeonRouteHistory: ['A1'] },
      enemy: { id: 'enemy', actorType: 'monster' as const, alive: true, nodeId: '21', nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 15, defense: 0, attack: 1, name: '巨蟒', encounterId: 'ordinary-dungeon-encounter', dungeonLocation },
    },
    dungeonRuntime: {
      schemaVersion: 1 as const, tripId, activeFloor: 1 as const, cellByActorId: { [actorId]: 'A2' },
      unlockedFloorByActorId: { [actorId]: 1 }, visitedCells: ['1:A1', '1:A2'], activeEncounterByCell: {},
      routeByActorId: { [actorId]: ['A1'] },
    },
  };
  const actions = availableActions(state, actorId, graph, undefined, content);
  assert.equal(actions.some(({ id }) => id === 'dungeon-retreat:A1'), true);
  assert.equal(actions.some(({ type }) => type === 'dungeon-move'), false);
});

test('surface monsters never block moving or retreating through their Node', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'route-node-blocked', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const state = {
    ...initial,
    actors: {
      ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nodeId: null, nextActionAtT: 100 }])),
      [actorId]: { ...initial.actors[actorId]!, nodeId: '2', nextActionAtT: 0, routeHistory: ['1'] },
      enemy: { id: 'enemy', actorType: 'monster' as const, alive: true, nodeId: '2', nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 5, defense: 0, attack: 0, name: '森林野豬' },
      blocker: { id: 'blocker', actorType: 'monster' as const, alive: true, nodeId: '1', nextActionAtT: 100, speed: 2, unsafeEntryAtT: 0, sleeping: false, hitPoints: 2, defense: 0, attack: 0, name: '夜間蝙蝠' },
    },
    nodes: { ...initial.nodes, '1': { ...initial.nodes['1']!, surfaceTerrain: 'beach' as const } },
  };
  const actions = availableActions(state, actorId, graph, undefined, content);
  assert.equal(actions.some(({ id }) => id === 'move:1'), true);
  assert.equal(actions.some(({ id }) => id === 'retreat:1'), true);
  const retreat = actions.find(({ id }) => id === 'retreat:1');
  assert.ok(retreat);
  const moved = settleNextAction(state, { actorId, actionId: retreat.id, timeCostT: retreat.costT, payload: retreat.payload }, graph, undefined, content);
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(moved.state.actors[actorId]?.nodeId, null);
  assert.equal(moved.state.actors[actorId]?.travel?.toNodeId, '1');
  const arrival = settleNextTimerEvent(moved.state, {}, { surfaceEntryEvents: content.surfaceEntryEvents, surfaceMonsters: content.monsters });
  assert.equal(arrival.ok, true);
  if (!arrival.ok) return;
  assert.equal(arrival.state.actors[actorId]?.nodeId, '1');
  assert.equal(arrival.event.kind, 'resident-arrived');
  const arrivalPayload = arrival.event.payload as { surfaceEntry?: { terrain: string | null; triggered: boolean } };
  assert.equal(arrivalPayload.surfaceEntry?.terrain, 'beach');
  assert.equal(typeof arrivalPayload.surfaceEntry?.triggered, 'boolean');
});

test('independent night river bear roll creates a same-Node scheduled monster actor', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'night-river-bear-action', contentVersion: 'surface-rules-2026-10-22' });
  const content = await loadSimulationActionContent(sourceTables);
  const actorId = 'resident-01';
  let rngState = '00000001';
  for (let candidate = 1; candidate < 100_000; candidate += 1) {
    const state = candidate.toString(16).padStart(8, '0');
    const random = new SeededRandom(state);
    if (random.next('surface.river.bear.night').value < 0.15) { rngState = state; break; }
  }
  const state = {
    ...initial, worldTimeT: 48, rngState,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor, alive: actor.id === actorId, nodeId: actor.id === actorId ? '24' : null,
      nextActionAtT: actor.id === actorId ? 48 : 100,
    }])),
  };
  const dive = availableActions(state, actorId, graph, undefined, content).find(({ id }) => id === 'surface:night-river-dive');
  assert.ok(dive);
  const result = settleNextAction(state, { actorId, actionId: dive.id, timeCostT: dive.costT, payload: dive.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const payload = result.event.payload as { spawnMonsterName: string; spawnedMonsterId: string };
  assert.equal(payload.spawnMonsterName, '河流夜熊');
  const bear = result.state.actors[payload.spawnedMonsterId];
  assert.equal(bear?.actorType, 'monster');
  assert.equal(bear?.name, '河流夜熊');
  assert.equal(bear?.nodeId, '24');
  assert.equal(bear?.nextActionAtT, result.event.worldTimeT);
  const next = nextWorldEvent(result.state);
  assert.equal(next.kind, 'resident-action');
  if (next.kind !== 'resident-action') return;
  const wait = availableActions(result.state, next.actorIds[0]!, graph, undefined, content).find(({ id }) => id === 'wait');
  assert.ok(wait);
  const advanced = settleNextAction(result.state, { actorId: next.actorIds[0]!, actionId: wait.id, timeCostT: wait.costT, payload: wait.payload }, graph, undefined, content);
  assert.equal(advanced.ok, true);
  if (!advanced.ok) return;
  assert.equal(nextWorldEvent(advanced.state).kind, 'monster-action');
});

test('rolls forest entry and creates a source-matched monster only on the 3T arrival', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'forest-arrival-encounter', contentVersion: 'archive-01669CAC' });
  const content = await loadSimulationActionContent(sourceTables);
  const actorId = 'resident-01';
  const targetNodeId = '9';
  const edge = graph.edges.find(({ source, target }) => source === targetNodeId || target === targetNodeId);
  assert.ok(edge);
  const fromNodeId = edge.source === targetNodeId ? edge.target : edge.source;
  const forestRows = content.surfaceEntryEvents;
  let rngState = '00000001';
  for (let candidate = 1; candidate < 100_000; candidate += 1) {
    const candidateState = candidate.toString(16).padStart(8, '0');
    const roll = resolveSurfaceEntry({
      actorId, nodeId: targetNodeId, worldTimeT: 0, phase: 'day', terrain: 'forest', rows: forestRows, randomState: candidateState,
    });
    if (roll.triggered && roll.outcome?.outcome === '森林野豬') { rngState = candidateState; break; }
  }
  const state = {
    ...initial,
    rngState,
    nodes: { ...initial.nodes, [targetNodeId]: { ...initial.nodes[targetNodeId]!, surfaceTerrain: 'forest' as const } },
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor,
      alive: actor.id === actorId,
      nodeId: actor.id === actorId ? fromNodeId : null,
      nextActionAtT: actor.id === actorId ? 0 : 100,
    }])),
  };
  const move = availableActions(state, actorId, graph).find(({ id }) => id === `move:${targetNodeId}`);
  assert.ok(move);
  assert.equal(move.costT, 3);
  const result = settleNextAction(state, { actorId, actionId: move.id, timeCostT: 3, payload: move.payload }, graph, undefined, content);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.worldTimeT, 0);
  assert.equal(result.state.actors[actorId]?.nodeId, null);
  assert.equal(result.state.actors[actorId]?.nextActionAtT, 3);
  assert.equal(result.state.actors[actorId]?.unsafeEntryAtT, null);
  assert.equal(result.state.actors[actorId]?.travel?.arrivesAtT, 3);
  assert.equal(Object.values(result.state.actors).some(({ actorType }) => actorType === 'monster'), false);
  const arrival = settleNextTimerEvent(result.state, {}, { surfaceEntryEvents: content.surfaceEntryEvents, surfaceMonsters: content.monsters });
  assert.equal(arrival.ok, true);
  if (!arrival.ok) return;
  assert.equal(arrival.state.actors[actorId]?.nodeId, targetNodeId);
  assert.equal(arrival.state.actors[actorId]?.unsafeEntryAtT, 3);
  const monster = Object.values(arrival.state.actors).find(({ actorType }) => actorType === 'monster');
  assert.equal(monster?.name, '森林野豬');
  assert.equal(monster?.nodeId, targetNodeId);
  assert.equal(monster?.nextActionAtT, 3);
  assert.equal(monster?.spawnedAtSequence, arrival.state.sequence);
  assert.equal((arrival.event.payload as { surfaceEntry?: { outcomeId: string; spawnedMonsterId: string | null } }).surfaceEntry?.outcomeId, '森林野豬');
  assert.equal((arrival.event.payload as { surfaceEntry?: { spawnedMonsterId: string | null } }).surfaceEntry?.spawnedMonsterId, monster?.id);
  const spawnRoundNextEvent = nextWorldEvent(arrival.state);
  assert.notEqual(spawnRoundNextEvent.kind, 'monster-action');
  assert.equal(spawnRoundNextEvent.kind, 'resident-action');
  if (spawnRoundNextEvent.kind !== 'resident-action') return;
  const residentWait = availableActions(arrival.state, spawnRoundNextEvent.actorIds[0]!, graph).find(({ id }) => id === 'wait');
  assert.ok(residentWait);
  const advancedRound = settleNextAction(arrival.state, {
    actorId: spawnRoundNextEvent.actorIds[0]!, actionId: residentWait.id,
    timeCostT: residentWait.costT, payload: residentWait.payload,
  }, graph);
  assert.equal(advancedRound.ok, true);
  if (!advancedRound.ok) return;
  const monsterTurn = nextWorldEvent(advancedRound.state);
  assert.equal(monsterTurn.kind, 'monster-action');
  if (monsterTurn.kind !== 'monster-action') return;
  assert.equal(monsterTurn.monsterId, monster?.id);
  const monsterSettled = settleNextTimerEvent(advancedRound.state, {}, {
    monsters: content.monsters,
    attackDistributions: content.attackDistributions,
  });
  assert.equal(monsterSettled.ok, true);
  if (!monsterSettled.ok) return;
  assert.equal(monsterSettled.event.kind, 'monster-action-settled');
  assert.equal(monsterSettled.state.actors[monster!.id]?.nextActionAtT, 4);
  assert.equal(monsterSettled.state.actors[actorId]?.lastActionResult?.includes('森林野豬'), true);
  const noBoarSeed = Array.from({ length: 100_000 }, (_, index) => (index + 1).toString(16).padStart(8, '0')).find((candidate) => {
    const roll = resolveSurfaceEntry({ actorId, nodeId: targetNodeId, worldTimeT: 0, phase: 'day', terrain: 'forest', rows: forestRows, randomState: candidate });
    return !roll.triggered || roll.outcome?.outcome !== '森林野豬';
  });
  assert.ok(noBoarSeed);
  const nonMonsterOutcomeState = {
    ...state,
    rngState: noBoarSeed,
    actors: { ...state.actors, [actorId]: { ...state.actors[actorId]!, nextActionAtT: 0 } },
  };
  const nonMonsterMove = availableActions(nonMonsterOutcomeState, actorId, graph).find(({ id }) => id === `move:${targetNodeId}`);
  assert.ok(nonMonsterMove);
  const withoutMonster = settleNextAction(nonMonsterOutcomeState, { actorId, actionId: nonMonsterMove.id, timeCostT: 3, payload: nonMonsterMove.payload }, graph, undefined, content);
  assert.equal(withoutMonster.ok, true);
  if (withoutMonster.ok) {
    assert.equal(Object.values(withoutMonster.state.actors).some(({ actorType }) => actorType === 'monster'), false);
    const arrival = settleNextTimerEvent(withoutMonster.state, {}, { surfaceEntryEvents: content.surfaceEntryEvents, surfaceMonsters: content.monsters });
    assert.equal(arrival.ok, true);
    if (arrival.ok) assert.equal(arrival.state.unresolved?.some(({ sourceId }) => sourceId === 'surface-entry'), false);
  }
});

test('night movement checks terrain first, then selects and schedules one weighted enemy only on a hit', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'night-move-encounter', contentVersion: 'archive-01669CAC' });
  const content = await loadSimulationActionContent(sourceTables);
  const actorId = 'resident-01';
  const targetNodeId = '9';
  const edge = graph.edges.find(({ source, target }) => source === targetNodeId || target === targetNodeId);
  assert.ok(edge);
  const fromNodeId = edge.source === targetNodeId ? edge.target : edge.source;
  const targetNode = { ...initial.nodes[targetNodeId]!, surfaceTerrain: 'forest' as const };
  const encounterSeed = Array.from({ length: 500 }, (_, index) => (index + 1).toString(16).padStart(8, '0'))
    .find((candidate) => resolveNightEncounterCheck({ node: targetNode, actorId, worldTimeT: 51, randomState: candidate }).encounter);
  assert.ok(encounterSeed);
  const base = {
    ...initial, worldTimeT: 48, rngState: encounterSeed,
    nodes: { ...initial.nodes, [targetNodeId]: targetNode },
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, {
      ...resident, alive: resident.id === actorId, nodeId: resident.id === actorId ? fromNodeId : null,
      nextActionAtT: resident.id === actorId ? 48 : 100,
    }])),
  };
  const move = availableActions(base, actorId, graph).find(({ id }) => id === `move:${targetNodeId}`);
  assert.ok(move);
  const departure = settleNextAction(base, { actorId, actionId: move.id, timeCostT: move.costT, payload: move.payload }, graph, undefined, content);
  assert.equal(departure.ok, true);
  if (!departure.ok) return;
  assert.equal(departure.state.actors[actorId]?.nodeId, null);
  const hit = settleNextTimerEvent(departure.state, {}, { surfaceEntryEvents: content.surfaceEntryEvents, surfaceMonsters: content.monsters });
  assert.equal(hit.ok, true);
  if (!hit.ok) return;
  const encounter = (hit.event.payload as { nightEncounter: { encountered: boolean; hitPointChange: number; enemyName: string; spawnedMonsterId: string } }).nightEncounter;
  assert.equal(encounter.encountered, true);
  assert.equal(encounter.hitPointChange, -1);
  assert.ok(['夜間蝙蝠', '夜狼'].includes(encounter.enemyName));
  assert.equal(hit.state.actors[actorId]?.hitPoints, (base.actors[actorId]?.hitPoints ?? 0) - 1);
  assert.equal(hit.state.actors[encounter.spawnedMonsterId]?.name, encounter.enemyName);
  assert.equal(hit.state.actors[encounter.spawnedMonsterId]?.nodeId, targetNodeId);
  assert.equal((hit.event.payload as { surfaceEntry?: unknown }).surfaceEntry, undefined);

  const lethalBase = {
    ...base,
    actors: { ...base.actors, [actorId]: { ...base.actors[actorId]!, hitPoints: 1 } },
  };
  const lethalMove = availableActions(lethalBase, actorId, graph).find(({ id }) => id === `move:${targetNodeId}`);
  assert.ok(lethalMove);
  const lethalDeparture = settleNextAction(lethalBase, { actorId, actionId: lethalMove.id, timeCostT: lethalMove.costT, payload: lethalMove.payload }, graph, undefined, content);
  assert.equal(lethalDeparture.ok, true);
  if (!lethalDeparture.ok) return;
  const lethalArrival = settleNextTimerEvent(lethalDeparture.state, {}, { surfaceEntryEvents: content.surfaceEntryEvents, surfaceMonsters: content.monsters });
  assert.equal(lethalArrival.ok, true);
  if (!lethalArrival.ok) return;
  assert.equal(lethalArrival.state.actors[actorId]?.alive, false);
  assert.equal(Object.values(lethalArrival.state.actors).some(({ actorType, name }) => actorType === 'monster' && name === encounter.enemyName), false);
  assert.equal(lethalArrival.state.unresolved?.some(({ sourceId }) => sourceId === 'surface-night-encounter'), false);
  assert.equal((hit.event.payload as { terrainEntry?: unknown }).terrainEntry, undefined);
  assert.equal(hit.event.randomDraws.length, 2);
  assert.equal((hit.state.actors[encounter.spawnedMonsterId]?.spawnedAtSequence), hit.state.sequence);
  const spawnRoundNextEvent = nextWorldEvent(hit.state);
  assert.equal(spawnRoundNextEvent.kind, 'resident-action');
  if (spawnRoundNextEvent.kind !== 'resident-action') return;
  const nextResidentId = spawnRoundNextEvent.actorIds[0];
  assert.ok(nextResidentId);
  const residentWait = availableActions(hit.state, nextResidentId, graph, undefined, content).find(({ id }) => id === 'wait');
  assert.ok(residentWait);
  const advancedRound = settleNextAction(hit.state, {
    actorId: nextResidentId, actionId: residentWait.id,
    timeCostT: residentWait.costT, payload: residentWait.payload,
  }, graph, undefined, content);
  assert.equal(advancedRound.ok, true);
  if (!advancedRound.ok) return;
  const monsterTurn = nextWorldEvent(advancedRound.state);
  assert.equal(monsterTurn.kind, 'monster-action');
  if (monsterTurn.kind !== 'monster-action') return;
  assert.equal(monsterTurn.monsterId, encounter.spawnedMonsterId);
  const afterMonster = settleNextTimerEvent(advancedRound.state, {}, { monsters: content.monsters, attackDistributions: content.attackDistributions });
  assert.equal(afterMonster.ok, true);
  if (!afterMonster.ok) return;
  const hitResult = (afterMonster.event.payload as { hits: readonly { targetId: string; appliedDamage: number }[] }).hits.find(({ targetId }) => targetId === actorId);
  assert.ok(hitResult);
  assert.equal(afterMonster.state.actors[actorId]?.hitPoints, advancedRound.state.actors[actorId]?.hitPoints! - hitResult.appliedDamage);
  assert.equal(afterMonster.event.actorId, encounter.spawnedMonsterId);

  const missSeed = '00002000';
  assert.equal(resolveNightEncounterCheck({ node: initial.nodes[targetNodeId], actorId, worldTimeT: 51, randomState: missSeed }).encounter, false);
  const missState = {
    ...base, rngState: missSeed,
    objects: { fire: { id: 'unlit-fire', itemId: '營火', lit: false, ownerActorId: null, nodeId: targetNodeId, generatedAtT: 40, expiresAtT: 60, unique: false, provisional: false } },
  };
  const missMove = availableActions(missState, actorId, graph).find(({ id }) => id === `move:${targetNodeId}`);
  assert.ok(missMove);
  const missDeparture = settleNextAction(missState, { actorId, actionId: missMove.id, timeCostT: missMove.costT, payload: missMove.payload }, graph, undefined, content);
  assert.equal(missDeparture.ok, true);
  if (!missDeparture.ok) return;
  const miss = settleNextTimerEvent(missDeparture.state, {}, { surfaceEntryEvents: content.surfaceEntryEvents, surfaceMonsters: content.monsters });
  assert.equal(miss.ok, true);
  if (!miss.ok) return;
  assert.equal((miss.event.payload as { nightEncounter: { encountered: boolean } }).nightEncounter.encountered, false);
  assert.notEqual((miss.event.payload as { surfaceEntry?: unknown }).surfaceEntry, undefined);
  assert.equal(Object.values(miss.state.actors).some((candidate) => candidate.actorType === 'monster'), false);
});

test('an active lit campfire suppresses night movement encounters and the entry pool', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'night-move-campfire', contentVersion: 'archive-01669CAC' });
  const content = await loadSimulationActionContent(sourceTables);
  const actorId = 'resident-01';
  const targetNodeId = '9';
  const edge = graph.edges.find(({ source, target }) => source === targetNodeId || target === targetNodeId);
  assert.ok(edge);
  const fromNodeId = edge.source === targetNodeId ? edge.target : edge.source;
  const state = {
    ...initial, worldTimeT: 48,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, {
      ...resident, alive: resident.id === actorId, nodeId: resident.id === actorId ? fromNodeId : null,
      nextActionAtT: resident.id === actorId ? 48 : 100,
    }])),
    objects: { ...initial.objects, fire: { id: 'fire', itemId: '營火', lit: true, ownerActorId: null, nodeId: targetNodeId, generatedAtT: 40, expiresAtT: 60, unique: false, provisional: false } },
  };
  const move = availableActions(state, actorId, graph).find(({ id }) => id === `move:${targetNodeId}`);
  assert.ok(move);
  const departure = settleNextAction(state, { actorId, actionId: move.id, timeCostT: move.costT, payload: move.payload }, graph, undefined, content);
  assert.equal(departure.ok, true);
  if (!departure.ok) return;
  assert.equal(departure.state.actors[actorId]?.nodeId, null);
  const result = settleNextTimerEvent(departure.state, {}, { surfaceEntryEvents: content.surfaceEntryEvents, surfaceMonsters: content.monsters });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.event.payload as { nightEncounter?: unknown }).nightEncounter, undefined);
  assert.equal((result.event.payload as { surfaceEntry?: unknown }).surfaceEntry, undefined);
  assert.equal(result.event.randomDraws.length, 0);
  assert.equal(result.state.actors[actorId]?.hitPoints, state.actors[actorId]?.hitPoints);
  assert.equal(Object.values(result.state.actors).some(({ actorType }) => actorType === 'monster'), false);
});

test('a lit campfire suppresses daytime entry events too', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'day-move-campfire', contentVersion: 'night-move-campfire' });
  const content = await loadSimulationActionContent(sourceTables);
  const actorId = 'resident-01';
  const targetNodeId = '9';
  const edge = graph.edges.find(({ source, target }) => source === targetNodeId || target === targetNodeId);
  assert.ok(edge);
  const fromNodeId = edge.source === targetNodeId ? edge.target : edge.source;
  const state = {
    ...initial, worldTimeT: 12,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, {
      ...resident, alive: resident.id === actorId, nodeId: resident.id === actorId ? fromNodeId : null,
      nextActionAtT: resident.id === actorId ? 12 : 100,
    }])) ,
    objects: { ...initial.objects, fire: { id: 'fire', itemId: '營火', lit: true, ownerActorId: null, nodeId: targetNodeId, generatedAtT: 0, expiresAtT: null, unique: false, provisional: false } },
  };
  const move = availableActions(state, actorId, graph).find(({ id }) => id === `move:${targetNodeId}`);
  assert.ok(move);
  const departure = settleNextAction(state, { actorId, actionId: move.id, timeCostT: move.costT, payload: move.payload }, graph, undefined, content);
  assert.equal(departure.ok, true);
  if (!departure.ok) return;
  const result = settleNextTimerEvent(departure.state, {}, { surfaceEntryEvents: content.surfaceEntryEvents, surfaceMonsters: content.monsters });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.event.payload as { nightEncounter?: unknown }).nightEncounter, undefined);
  assert.equal((result.event.payload as { surfaceEntry?: unknown }).surfaceEntry, undefined);
  assert.equal(result.event.randomDraws.length, 0);
});

test('orders same-speed monsters by shared metrics and records a seeded draw for full ties', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'monster-same-speed', contentVersion: 'test-source' });
  const targetId = 'resident-01';
  const nodeId = initial.actors[targetId]!.nodeId!;
  const baseActors = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: 100, nodeId: actor.id === targetId ? nodeId : null }]));
  const monster = (id: string, hitPoints: number): WorldActor => ({
    id, actorType: 'monster', alive: true, nodeId, nextActionAtT: 0, speed: 4, unsafeEntryAtT: 0, sleeping: false,
    hitPoints, defense: 0, name: '夜狼', travel: null,
  });
  const highHpFirst = { ...initial, actors: { ...baseActors, 'wolf-a': monster('wolf-a', 11), 'wolf-b': monster('wolf-b', 12) } };
  const highHpEvent = nextWorldEvent(highHpFirst);
  assert.equal(highHpEvent.kind, 'monster-action');
  if (highHpEvent.kind === 'monster-action') assert.equal(highHpEvent.monsterId, 'wolf-b');

  const tied = { ...initial, actors: { ...baseActors, 'wolf-a': monster('wolf-a', 12), 'wolf-b': monster('wolf-b', 12) } };
  const tieEvent = nextWorldEvent(tied);
  assert.equal(tieEvent.kind, 'monster-action');
  if (tieEvent.kind !== 'monster-action') return;
  assert.equal(tieEvent.unresolved.length, 0);
  assert.equal(tieEvent.randomDraws?.length, 1);
  assert.equal(tieEvent.randomDraws?.[0]?.sourceId, 'same-speed-priority-final-draw');
  const result = settleNextTimerEvent(tied, {}, { monsters: content.monsters, attackDistributions: content.attackDistributions });
  assert.equal(result.ok, true, result.ok ? '' : result.unresolved.join('; '));
  if (!result.ok) return;
  assert.equal(result.event.actorId, tieEvent.monsterId);
  assert.equal(result.event.randomDraws[0]?.sourceId, 'same-speed-priority-final-draw');
});

test('orders same-time resident and monster actions by speed and approved same-speed metrics', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'mixed-actor-speed-order', contentVersion: 'archive-01669CAC' });
  const resident = initial.actors['resident-01'];
  assert.ok(resident?.nodeId);
  const actors = {
    ...Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, { ...actor, nextActionAtT: actor.id === resident.id ? 0 : 100, speed: actor.id === resident.id ? 3 : actor.speed }])),
    'monster-speed-test': {
      id: 'monster-speed-test', actorType: 'monster' as const, alive: true, nodeId: resident.nodeId,
      nextActionAtT: 0, speed: 5, unsafeEntryAtT: 0, sleeping: false, hitPoints: 10, defense: 0, attack: 0,
      name: '森林野豬', travel: null,
    },
  } as typeof initial.actors;
  const fasterMonster = nextWorldEvent({ ...initial, actors });
  assert.equal(fasterMonster.kind, 'monster-action');
  const fasterResident = nextWorldEvent({ ...initial, actors: { ...actors, 'resident-01': { ...actors['resident-01']!, speed: 6 } } });
  assert.equal(fasterResident.kind, 'resident-action');
  const tiedSpeed = nextWorldEvent({ ...initial, actors: { ...actors, 'resident-01': { ...actors['resident-01']!, speed: 5 } } });
  assert.equal(tiedSpeed.kind, 'resident-action');
  if (tiedSpeed.kind === 'resident-action') assert.equal(tiedSpeed.actorIds[0], 'resident-01');
});

test('settles WAIT as a one-T action and advances only the waiting resident', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'wait-one-tick', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const state = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor,
      nextActionAtT: actor.id === actorId ? 0 : 5,
    }])),
  };
  const wait = availableActions(state, actorId, graph).find(({ id }) => id === 'wait');
  assert.ok(wait);
  assert.equal(wait.costT, 1);

  const wrongDuration = settleNextAction(state, { actorId, actionId: wait.id, timeCostT: 3, payload: wait.payload }, graph);
  assert.equal(wrongDuration.ok, false);
  assert.equal(wrongDuration.state, state);

  const settled = settleNextAction(state, { actorId, actionId: wait.id, timeCostT: 1, payload: wait.payload }, graph);
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  assert.equal(settled.state.worldTimeT, 0);
  assert.equal(settled.state.actors[actorId]?.nextActionAtT, 1);
  assert.deepEqual(Object.values(settled.state.actors)
    .filter((actor) => actor.id !== actorId)
    .map((actor) => actor.nextActionAtT), Array(9).fill(5));
  assert.deepEqual(orderNextResidents(settled.state).actorIds, [actorId]);
  assert.equal(orderNextResidents(settled.state).actionTimeT, 1);
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
      object_due: { id: 'object_due', itemId: 'unopened-pack', objectType: 'container' as const, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: 0, expiresAtT: 5, unique: false, provisional: true },
    },
  };
  assert.deepEqual(nextWorldEvent(state), { kind: 'object-expiry', timeT: 5, objectId: 'object_due' });
  const expired = settleNextTimerEvent(state);
  assert.equal(expired.ok, true);
  if (expired.ok) {
    assert.equal(expired.state.objects.object_due, undefined);
    assert.equal(expired.event.kind, 'world-object-expired');
  }
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
    nodes: { ...state.nodes, [nodeId]: { ...state.nodes[nodeId]!, surfaceTerrain: 'beach' as const, safe: false } },
  };
  const riskEvent = nextWorldEvent(unsafeState);
  assert.equal(riskEvent.kind, 'personal-sleep-risk-unresolved');
  if (riskEvent.kind === 'personal-sleep-risk-unresolved') {
    assert.equal(riskEvent.timeT, 51);
    assert.equal(riskEvent.actorId, sleeperId);
    assert.deepEqual(riskEvent.unresolved, []);
  }
});

test('settles unsafe sleep at the current Node rate, applies one fixed HP before waking', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const content = await loadSimulationActionContent(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'sleep-risk-effect', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const actor = initial.actors[actorId];
  assert.ok(actor?.nodeId);
  const node = { ...initial.nodes[actor.nodeId]!, surfaceTerrain: 'beach' as const };
  const startingRandomState = Array.from({ length: 500 }, (_, index) => (index + 1).toString(16).padStart(8, '0'))
    .find((candidate) => resolveNightEncounterCheck({ node, actorId, worldTimeT: 51, randomState: candidate }).encounter);
  assert.ok(startingRandomState);
  const state = {
    ...initial,
    worldTimeT: 48,
    rngState: startingRandomState,
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, resident.id === actorId
      ? { ...resident, sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 80, hitPoints: 5 }
      : { ...resident, nextActionAtT: 80 }])),
    nodes: { ...initial.nodes, [actor.nodeId]: node },
  };
  const result = settleNextTimerEvent(state, {}, { monsters: content.monsters });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'personal-sleep-risk-settled');
  assert.equal(result.state.actors[actorId]?.hitPoints, 4);
  assert.equal(result.state.actors[actorId]?.sleeping, false);
  assert.equal(result.state.actors[actorId]?.nextActionAtT, 51);
  const check = (result.event.payload as { checks: readonly { hitPointChange: number; woke: boolean; enemyName: string; spawnedMonsterId: string }[] }).checks[0];
  assert.equal(check?.hitPointChange, -1);
  assert.equal(check?.woke, true);
  assert.equal(result.state.actors[check!.spawnedMonsterId]?.name, check?.enemyName);
  assert.equal(result.state.actors[check!.spawnedMonsterId]?.nodeId, actor.nodeId);
  assert.equal(result.randomDraws.length, 2);
});

test('fails closed before consuming randomness when a due sleeper has no source-backed terrain', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'unmapped-sleep-terrain', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const state = {
    ...initial,
    worldTimeT: 48,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, actor.id === actorId
      ? { ...actor, nodeId: '15', sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 80 }
      : { ...actor, nextActionAtT: 80 }])),
    nodes: { ...initial.nodes, '15': { ...initial.nodes['15']!, surfaceTerrain: null } },
  };

  const scheduled = nextWorldEvent(state);
  assert.equal(scheduled.kind, 'personal-sleep-risk-unresolved');
  if (scheduled.kind !== 'personal-sleep-risk-unresolved') return;
  assert.match(scheduled.unresolved.join(' '), /Node 15/);
  const result = settleNextTimerEvent(state);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.unresolved.join(' '), /Node 15/);
  assert.deepEqual(state.rngState, initial.rngState);
  assert.equal(result.state.sequence, state.sequence);
  assert.equal(result.state.worldTimeT, state.worldTimeT);
});

test('a lit campfire suppresses the sleeping encounter check, and a lethal encounter does not wake or spawn a monster', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'sleep-fire-lethal', contentVersion: 'archive-01669CAC' });
  const actorId = 'resident-01';
  const actor = initial.actors[actorId];
  assert.ok(actor?.nodeId);
  const node = { ...initial.nodes[actor.nodeId]!, surfaceTerrain: 'beach' as const };
  const campfireState = {
    ...initial, worldTimeT: 48,
    nodes: { ...initial.nodes, [actor.nodeId]: node },
    actors: Object.fromEntries(Object.values(initial.actors).map((resident) => [resident.id, resident.id === actorId
      ? { ...resident, sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 80 }
      : { ...resident, nextActionAtT: 80 }])),
    objects: { ...initial.objects, fire: { id: 'fire', itemId: '營火', lit: true, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: 48, expiresAtT: 73, unique: false, provisional: false } },
  };
  assert.notEqual(nextWorldEvent(campfireState).kind, 'personal-sleep-risk-unresolved');
  const unlitFire = { ...campfireState, objects: { fire: { ...campfireState.objects.fire!, lit: false } } };
  assert.equal(nextWorldEvent(unlitFire).kind, 'personal-sleep-risk-unresolved');
  const expiredFire = { ...campfireState, objects: { fire: { ...campfireState.objects.fire!, expiresAtT: 51 } } };
  assert.equal(nextWorldEvent(expiredFire).kind, 'personal-sleep-risk-unresolved');
  const seed = Array.from({ length: 500 }, (_, index) => (index + 1).toString(16).padStart(8, '0'))
    .find((candidate) => resolveNightEncounterCheck({ node, actorId, worldTimeT: 51, randomState: candidate }).encounter);
  assert.ok(seed);
  const lethalState = {
    ...campfireState, objects: {}, rngState: seed,
    actors: { ...campfireState.actors, [actorId]: { ...campfireState.actors[actorId]!, hitPoints: 1 } },
  };
  const result = settleNextTimerEvent(lethalState);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actors[actorId]?.hitPoints, 0);
  assert.equal(result.state.actors[actorId]?.alive, false);
  assert.equal(result.state.actors[actorId]?.sleeping, false);
  assert.equal(Object.values(result.state.actors).some((candidate) => candidate.actorType === 'monster'), false);
  assert.equal((result.event.payload as { checks: readonly { hitPointChange: number; woke: boolean }[] }).checks[0]?.hitPointChange, -1);
  assert.equal((result.event.payload as { checks: readonly { hitPointChange: number; woke: boolean }[] }).checks[0]?.woke, false);
});

test('advances a classified sleep check without using the removed generic-rate fallback', async () => {
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
    nodes: { ...initial.nodes, [actor.nodeId]: { ...initial.nodes[actor.nodeId]!, safe: false, surfaceTerrain: 'beach' as const } },
  };
  const result = settleNextTimerEvent(state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.worldTimeT, 51);
  assert.equal(result.state.unresolved?.some(({ detail }) => /17\.5|area-entry outcome table/.test(detail)), false);
  assert.equal(nextWorldEvent(result.state).kind, 'personal-sleep-risk-unresolved');
});

test('initializes a permanently lit campfire at the central camp and protects its sleepers', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'default-central-campfire', contentVersion: 'archive-01669CAC' });
  const fire = Object.values(initial.objects).find((object) => object.nodeId === '25' && object.itemId === '營火');
  assert.ok(fire);
  assert.equal(fire.lit, true);
  assert.equal(fire.expiresAtT, null);

  const resident = initial.actors['resident-01'];
  assert.ok(resident);
  const sleepingState = {
    ...initial,
    worldTimeT: 51,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, actor.id === resident.id
      ? { ...actor, nodeId: '25', sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 72 }
      : { ...actor, nextActionAtT: 100 }])) ,
  };
  assert.notEqual(nextWorldEvent(sleepingState).kind, 'personal-sleep-risk-unresolved');
});

test('a dungeon cell does not receive protection from a surface Node campfire', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'dungeon-no-campfire-effect', contentVersion: 'archive-01669CAC' });
  const resident = initial.actors['resident-01'];
  assert.ok(resident);
  const dungeonSleeper = {
    ...resident,
    nodeId: '25', sleeping: true, sleepingSinceT: 48, unsafeEntryAtT: 48, nextActionAtT: 72,
    dungeonLocation: { tripId: 'dungeon-trip-test', floor: 1, cellId: 'A1' },
  };
  const state = {
    ...initial,
    worldTimeT: 51,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, actor.id === resident.id
      ? dungeonSleeper
      : { ...actor, alive: false, nodeId: null, nextActionAtT: 100 }])) ,
  };
  assert.equal(nextWorldEvent(state).kind, 'personal-sleep-risk-unresolved');
});

test('a generic safe flag does not replace an active campfire for night protection', async () => {
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
  assert.equal(nextWorldEvent(state).kind, 'personal-sleep-risk-unresolved');
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
    objects: { ...initial.objects, fire: { id: 'fire', itemId: '營火', lit: true, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: 48, expiresAtT: 73, unique: false, provisional: false } },
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

test('replenishes all residents who died in the same night in one dawn batch to ten', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'same-night-multiple-deaths', contentVersion: 'archive-01669CAC' });
  const deadActors = Object.values(initial.actors).filter((actor) => actor.actorType === 'resident' && (actor.slotId === '0' || actor.slotId === '1'));
  assert.equal(deadActors.length, 2);
  const actors = Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
    ...actor,
    nextActionAtT: 90,
    ...(actor.slotId === '0' || actor.slotId === '1' ? { alive: false, hitPoints: 0, diedAtT: 60, inventory: [], equipment: {} } : {}),
  }]));
  const state = { ...initial, worldTimeT: 71, actors };

  const result = settleNextTimerEvent(state);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const livingResidents = Object.values(result.state.actors).filter((actor) => actor.actorType === 'resident' && actor.alive);
  assert.equal(livingResidents.length, 10);
  const newGenerations = (result.event.payload as { newGenerations: readonly { slotId: string; generation: number }[] }).newGenerations;
  assert.deepEqual(newGenerations.map(({ slotId, generation }) => ({ slotId, generation })), [
    { slotId: '0', generation: 2 },
    { slotId: '1', generation: 2 },
  ]);
  assert.equal(result.event.kind, 'daily-survival-settled');
  assert.equal(result.event.worldTimeT, 72);
});

test('replays the due day-boundary wake after another timer already advanced world time to dawn', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'same-time-dawn-wake', contentVersion: 'archive-01669CAC' });
  const sleeperId = 'resident-01';
  const sleeper = initial.actors[sleeperId];
  assert.ok(sleeper);
  const state = {
    ...initial,
    worldTimeT: 72,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, actor.id === sleeperId
      ? { ...actor, sleeping: true, sleepingSinceT: 48, nextActionAtT: 72 }
      : { ...actor, nextActionAtT: 100 }])) ,
  };

  assert.equal(nextWorldEvent(state).kind, 'day-boundary');
  const result = settleNextTimerEvent(state);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.kind, 'daily-survival-settled');
  assert.equal(result.state.actors[sleeperId]?.sleeping, false);
  assert.equal(result.state.actors[sleeperId]?.nextActionAtT, 72);
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
      [actor.id]: { ...actor, hitPoints: 3, hunger: 1, inventory: ['raw-fish', '勇者下甲'], equipment: { weapon: 'iron-sword' }, nextActionAtT: 90 },
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
  assert.ok(Object.values(result.state.objects).some((object) => object.itemId === '勇者下甲' && object.unique && object.expiresAtT === null));
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

test('scavenges and carries corpse objects through transit, then places them on arrival', async () => {
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
  assert.equal(moved.state.actors[actorId]?.nodeId, null);
  assert.equal(moved.state.objects[corpseId]?.nodeId, null);
  assert.equal(moved.state.objects[remainingLootId]?.nodeId, null);
  assert.equal(moved.state.objects[remainingLootId]?.ownerActorId, actorId);
  assert.equal(nextWorldEvent(moved.state).kind, 'travel-arrival');
  const arrival = settleNextTimerEvent(moved.state);
  assert.equal(arrival.ok, true);
  if (arrival.ok) {
    assert.equal(arrival.state.actors[actorId]?.nodeId, neighbor);
    assert.equal(arrival.state.objects[corpseId]?.nodeId, neighbor);
    assert.equal(arrival.state.objects[remainingLootId]?.nodeId, neighbor);
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
