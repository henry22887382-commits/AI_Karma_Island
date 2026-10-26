import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCsv, type CsvRow } from '../content/csv.ts';
import { activeForestBerryPool, forestEntryRates, SURFACE_USER_RULE_OVERRIDES } from '../content/surface-user-overrides.ts';
import { SeededRandom } from '../engine/random.ts';
import { loadIslandGraph } from '../content/island.ts';
import { resolveForestEntryEvent } from './forest-risk.ts';
import { resolveNightEncounterCheck, selectNightEnemy } from './night-encounter.ts';
import { advanceCoconutBeachStocks, advanceNightExplorationStreak, harvestCoconut, resolveAreaEntryRisk, resolveSurfaceAction, resolveSurfaceEntry, summarizeSurfaceEncounterSources } from './surface.ts';

const tableDir = new URL('../../references/tables/', import.meta.url);
async function csv(name: string): Promise<readonly CsvRow[]> {
  return parseCsv(await readFile(new URL(name, tableDir), 'utf8'));
}

test('source pools retain their own totals; exploration risk is separate from resource pools', async () => {
  const [fishing, surface, recovered] = await Promise.all([
    csv('fishing_pool.csv'), csv('surface_exploration.csv'), csv('recovered_surface_actions.csv'),
  ]);
  const sum = (rows: readonly CsvRow[], key: string): number => rows.reduce((n, row) => n + Number(row[key]), 0);
  assert.equal(sum(fishing.filter((row) => row.parent_group === 'main'), 'overall_probability_percent'), 100);
  assert.equal(sum(fishing.filter((row) => row.parent_group === 'main'), 'overall_probability_percent'), 100);
  assert.equal(sum(surface.filter((row) => row.location_action === '河流探索'), 'probability_percent'), 100);
  assert.equal(sum(surface.filter((row) => row.location_action === '岩石探索'), 'probability_percent'), 100);
  assert.equal(sum(surface.filter((row) => row.location_action === '岩石探索_夜間'), 'probability_percent'), 65);
  assert.equal(sum(recovered.filter((row) => row.action === '森林採野莓' && row.status?.startsWith('user_confirmed_active_')), 'probability_percent'), 100);
  assert.equal(recovered.some((row) => row.status === 'historical_superseded_not_active' && (row.action ?? '').startsWith('岩縫')), true);
});

test('terrain entry pools total 100 and calculate night real rates after enemy misses', async () => {
  const rows = await csv('surface_entry_events.csv');
  const sums = Object.fromEntries(['beach', 'forest', 'river', 'rock'].map((terrain) => [terrain,
    rows.filter((row) => row.terrain === terrain).reduce((total, row) => total + Number(row.probability_percent), 0),
  ]));
  assert.deepEqual(sums, { beach: 100, forest: 100, river: 100, rock: 100 });
  assert.deepEqual(SURFACE_USER_RULE_OVERRIDES.entry.triggerPercentByTerrain, { beach: 20, forest: 20, river: 20, rock: 20 });
  assert.deepEqual(Object.fromEntries(Object.entries(SURFACE_USER_RULE_OVERRIDES.entry.nightTriggerPercentByTerrain).map(([terrain, rate]) => [terrain, rate * (1 - SURFACE_USER_RULE_OVERRIDES.nightEncounter.encounterPercentByTerrain[terrain as keyof typeof SURFACE_USER_RULE_OVERRIDES.nightEncounter.encounterPercentByTerrain] / 100)])), { beach: 16, forest: 16, river: 16, rock: 16 });
  const forest = resolveSurfaceEntry({ terrain: 'forest', phase: 'night', rows, actorId: 'r', nodeId: 'n', worldTimeT: 1, randomState: seedForDraw('surface.entry.trigger.night.forest.n.r.1', (value) => value < 0.20) });
  assert.equal(forest.triggerPercent, 20);
  assert.ok(rows.some((row) => row.terrain === 'forest' && row.outcome === forest.outcome?.outcome));
  assert.equal(forest.overallOutcomePercent, Number(forest.outcome?.probability_percent) * 0.16);
});

test('berry forest gathering caps total berry acquisition at 20% while preserving a 5% poison share', async () => {
  const recovered = await csv('recovered_surface_actions.csv');
  const raw = recovered.filter((row) => row.action === '森林採野莓' && row.status === 'user_confirmed_active_2026-10-26');
  assert.deepEqual(raw.map((row) => [row.result_or_hazard, Number(row.probability_percent)]), [['莓果', 19], ['無收穫', 80], ['毒莓', 1]]);
  assert.deepEqual(activeForestBerryPool().map((row) => [row.outcome, row.probabilityPercent]), [['莓果', 19], ['無收穫', 80], ['毒莓', 1]]);
  const state = seedForDraw('surface.forest.berries', (value) => value < 0.75);
  const result = resolveSurfaceAction({
    action: 'forest-berry-gather', actor: { id: 'r', hitPoints: 10, hunger: 0, sleep: 0, inventory: [] },
    nodeId: 'forest', worldTimeT: 3, phase: 'day', actionAvailableAtNode: true, randomState: state,
    tables: { fishing: [], surface: [], recovered },
  });
  assert.equal(result.outcome, '莓果');
});

test('forest entry compatibility resolver uses only the terrain trigger, leaving outcomes to the unified table', () => {
  assert.deepEqual(forestEntryRates('day'), { triggerPercent: 20, overallNegativePercent: null });
  assert.deepEqual(forestEntryRates('night'), { triggerPercent: 20, overallNegativePercent: null });
  const base = { actorId: 'r', nodeId: 'forest', worldTimeT: 1, phase: 'night' as const, isForestNode: true, otherActorsAtNode: [] };
  const state = seedForDraw('forest.entry.trigger.forest.r.1', (value) => value < 0.20);
  const result = resolveForestEntryEvent({ ...base, randomState: state });
  assert.equal(result.category, 'triggered');
  assert.equal(result.selectedOutcome, null);
  assert.equal(result.randomDraws.length, 1);
  assert.equal(result.event?.payload.overallNegativePercent, null);
  assert.deepEqual(result.unresolved, []);
  const triggerMissState = seedForDraw('forest.entry.trigger.forest.r.1', (value) => value >= 0.20);
  const miss = resolveForestEntryEvent({ ...base, randomState: triggerMissState });
  assert.equal(miss.category, 'no-trigger');
  assert.equal(miss.randomDraws.length, 1);
});

test('occupied forest entry excludes self, blocks only on another living resident, and consumes no RNG', () => {
  const base = { actorId: 'r', nodeId: 'forest', worldTimeT: 10, phase: 'day' as const, isForestNode: true, randomState: '00000001' };
  const otherResident = resolveForestEntryEvent({ ...base, otherActorsAtNode: [{ id: 'other', alive: true, actorType: 'resident' as const }] });
  assert.equal(otherResident.randomDraws.length, 0);
  assert.equal(otherResident.rngStateAfter, base.randomState);
  const selfAndAnimal = resolveForestEntryEvent({ ...base, otherActorsAtNode: [
    { id: 'r', alive: true, actorType: 'resident' as const },
    { id: 'dead', alive: false, actorType: 'resident' as const },
    { id: 'animal', alive: true, actorType: 'animal' as const },
  ] });
  assert.ok(selfAndAnimal.randomDraws.length >= 1);
});

test('night encounter rates are 20% for each terrain', () => {
  const rates = SURFACE_USER_RULE_OVERRIDES.nightEncounter.encounterPercentByTerrain;
  assert.deepEqual(rates, { beach: 20, forest: 20, river: 20, rock: 20 });
  assert.equal(SURFACE_USER_RULE_OVERRIDES.unsafeSleep.damageOnEncounter, 1);
  for (const [visualType, terrain, probabilityPercent] of [
    ['beach', 'beach', 20], ['forest', 'forest', 20], ['river', 'river', 20], ['rock', 'rock', 20],
  ] as const) {
    const node = { id: terrain, visualType, surfaceTerrain: terrain, label: null, labelStatus: 'confirmed', neighbors: [], safe: false };
    const seed = seedForDraw(`surface.night-encounter.${terrain}.${terrain}.r.55`, (value) => value < probabilityPercent / 100);
    const result = resolveNightEncounterCheck({ node, actorId: 'r', worldTimeT: 55, randomState: seed });
    assert.equal(result.terrain, terrain);
    assert.equal(result.probabilityPercent, probabilityPercent);
    assert.equal(result.encounter, true);
    const missSeed = seedForDraw(`surface.night-encounter.${terrain}.${terrain}.r.55`, (value) => value >= probabilityPercent / 100);
    const miss = resolveNightEncounterCheck({ node, actorId: 'r', worldTimeT: 55, randomState: missSeed });
    assert.equal(miss.encounter, false);
    assert.equal(miss.unresolved, null);
    assert.equal(result.randomDraw?.sourceId, `surface.night-encounter.${terrain}.${terrain}.r.55`);
  }
});

test('night encounter resolution requires an explicit surface terrain and does not infer it from scene labels', () => {
  const node = { id: '3', visualType: '一般地形', surfaceTerrain: null, label: null, labelStatus: '未逐點命名', neighbors: [], safe: false };
  const result = resolveNightEncounterCheck({ node, actorId: 'r', worldTimeT: 55, randomState: '00000001' });
  assert.equal(result.terrain, null);
  assert.equal(result.probabilityPercent, null);
  assert.equal(result.randomDraw, null);
  assert.equal(result.unresolved, 'Node 3 has no source-backed surface terrain classification for the night encounter rate.');
});

test('the island source applies the supplied terrain map and preserves scene categories', async () => {
  const graph = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));
  for (const [terrain, expectedIds] of Object.entries({
    beach: ['2', '4', '7', '10', '12', '14', '16'],
    'coconut-beach': ['1', '8', '13'],
    forest: ['3', '11', '18', '25', '28'],
    'berry-forest': ['9', '17', '23'],
    river: ['5', '24', '26'],
    rock: ['6', '19', '20', '22'],
    'dungeon-entrance': ['21'],
  })) {
    assert.deepEqual(graph.nodes.filter((node) => node.surfaceTerrain === terrain).map((node) => node.id), expectedIds);
  }
  assert.equal(graph.nodes.find(({ id }) => id === '15')?.visualType, '港口');
  assert.equal(graph.nodes.find(({ id }) => id === '21')?.visualType, '地牢入口');
  assert.equal(graph.nodes.find(({ id }) => id === '25')?.visualType, '中央營地');
});

test('night enemy selection uses the user-specified 4:6 weights only after an encounter check succeeds', () => {
  const weights = SURFACE_USER_RULE_OVERRIDES.nightEncounter.enemyWeightByName;
  assert.deepEqual(weights, { 夜間蝙蝠: 4, 夜狼: 6 });
  const batSeed = seedForDraw('surface.night-enemy.24.r.51', (value) => value < 0.4);
  const wolfSeed = seedForDraw('surface.night-enemy.24.r.51', (value) => value >= 0.4);
  assert.equal(selectNightEnemy(batSeed, '24', 'r', 51).name, '夜間蝙蝠');
  assert.equal(selectNightEnemy(wolfSeed, '24', 'r', 51).name, '夜狼');
});

test('production island terrain rows use the active night rates and enemy weights without injected tables', async () => {
  const graph = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));
  const productionNodes = [
    { id: '11', terrain: 'forest', probabilityPercent: 20 },
    { id: '25', terrain: 'forest', probabilityPercent: 20 },
  ] as const;

  for (const expected of productionNodes) {
    const sourceNode = graph.nodes.find((node) => node.id === expected.id);
    assert.ok(sourceNode, `production Node ${expected.id} exists`);
    const node = { ...sourceNode, neighbors: [], safe: false };
    const sourceId = `surface.night-encounter.${expected.terrain}.${expected.id}.r.55`;
    const hitSeed = seedForDraw(sourceId, (value) => value < expected.probabilityPercent / 100);
    const result = resolveNightEncounterCheck({ node, actorId: 'r', worldTimeT: 55, randomState: hitSeed });
    assert.equal(result.terrain, expected.terrain);
    assert.equal(result.probabilityPercent, expected.probabilityPercent);
    assert.equal(result.encounter, true);
    assert.equal(selectNightEnemy(seedForDraw('surface.night-enemy.24.r.51', (value) => value < 0.4), '24', 'r', 51).name, '夜間蝙蝠');
    assert.equal(selectNightEnemy(seedForDraw('surface.night-enemy.24.r.51', (value) => value >= 0.4), '24', 'r', 51).name, '夜狼');
  }
});

test('latest sleep override records the 3T cadence and fixed damage before wake', () => {
  assert.equal(SURFACE_USER_RULE_OVERRIDES.unsafeSleep.unsafeCheckEveryT, 3);
  assert.equal(SURFACE_USER_RULE_OVERRIDES.unsafeSleep.maxChecksPerNight, 8);
  assert.equal(SURFACE_USER_RULE_OVERRIDES.unsafeSleep.applyEncounterDamageBeforeWake, true);
});

function seedForDraw(sourceId: string, predicate: (value: number) => boolean): string {
  for (let seed = 1; seed < 500_000; seed += 1) {
    const state = seed.toString(16).padStart(8, '0');
    const value = new SeededRandom(state).next(sourceId).value;
    if (predicate(value)) return state;
  }
  throw new Error('No deterministic seed was found for the requested draw range.');
}

test('surface actions draw reproducibly from source rows and expose effects without mutating actor input', async () => {
  const [fishing, surface, recovered] = await Promise.all([
    csv('fishing_pool.csv'), csv('surface_exploration.csv'), csv('recovered_surface_actions.csv'),
  ]);
  const randomState = Array.from({ length: 100_000 }, (_, index) => (index + 1).toString(16).padStart(8, '0')).find((candidate) => {
    const rng = new SeededRandom(candidate);
    const value = rng.next('fish').value;
    return value >= 0.4 && value < 0.65;
  });
  assert.ok(randomState !== undefined);
  const input = {
    actor: { id: 'r1', hitPoints: 10, hunger: 2, sleep: 1, inventory: [] as readonly string[] },
    nodeId: 'unresolved-node', worldTimeT: 12, phase: 'day' as const, actionAvailableAtNode: true, randomState,
    tables: { fishing, surface, recovered },
  };
  const first = resolveSurfaceAction({ ...input, action: 'fishing' });
  const replay = resolveSurfaceAction({ ...input, action: 'fishing' });
  assert.deepEqual(first, replay);
  assert.equal(first.timeCostT, 3);
  assert.equal(first.outcome, '普通魚');
  assert.equal(first.randomDraws.length, 1);
  assert.equal(first.rngStateAfter, first.randomDraws[0]?.stateAfter);
  assert.equal(first.actorDelta.inventory?.length, 1);
  assert.deepEqual(input.actor, { id: 'r1', hitPoints: 10, hunger: 2, sleep: 1, inventory: [] });
});

test('fishing rows use direct total probabilities and hero lower stays unique', async () => {
  const [fishing, surface, recovered] = await Promise.all([
    csv('fishing_pool.csv'), csv('surface_exploration.csv'), csv('recovered_surface_actions.csv'),
  ]);
  const common = { actor: { id: 'r', hitPoints: 10, hunger: 0, sleep: 0, inventory: [] as readonly string[] }, nodeId: 'f', worldTimeT: 0, phase: 'day' as const, actionAvailableAtNode: true, tables: { fishing, surface, recovered } };
  assert.deepEqual(fishing.filter((row) => row.parent_group === 'main').map((row) => Number(row.overall_probability_percent)), [40, 25, 5, 5, 5, 12, 4, 2, 2]);
  const state = Array.from({ length: 100_000 }, (_, index) => (index + 1).toString(16).padStart(8, '0')).find((candidate) => {
    const rng = new SeededRandom(candidate);
    return rng.next('main').value >= 0.98;
  });
  assert.ok(state !== undefined);
  const result = resolveSurfaceAction({ ...common, action: 'fishing', randomState: state, existingUniqueItems: ['勇者下甲'] });
  assert.equal(result.timeCostT, 3);
  assert.equal(result.outcome, '勇者下甲');
  assert.equal(result.randomDraws.length, 1);
  assert.equal(result.uniqueItemAlreadyExists, true);
  assert.equal(result.actorDelta.inventory, undefined);
});

test('river exploration gives a priority bear event; only a bear miss reaches the fish pool', async () => {
  const [fishing, surface, recovered] = await Promise.all([
    csv('fishing_pool.csv'), csv('surface_exploration.csv'), csv('recovered_surface_actions.csv'),
  ]);
  assert.equal(Number(surface.find((row) => row.location_action === '河流探索_白天')?.probability_percent), 5);
  assert.equal(Number(surface.find((row) => row.location_action === '河流探索_夜間')?.probability_percent), 15);
  const state = Array.from({ length: 100_000 }, (_, index) => (index + 1).toString(16).padStart(8, '0')).find((candidate) => {
    const rng = new SeededRandom(candidate);
    return rng.next('surface.river.bear.night').value < 0.15;
  });
  assert.ok(state);
  const result = resolveSurfaceAction({
    action: 'night-river-dive', actor: { id: 'r', hitPoints: 10, hunger: 0, sleep: 0, inventory: [] },
    nodeId: 'river', worldTimeT: 30, phase: 'night', actionAvailableAtNode: true, randomState: state, tables: { fishing, surface, recovered },
  });
  assert.equal(result.outcome, '河流夜熊');
  assert.equal(result.spawnMonsterName, '河流夜熊');
  assert.equal(result.randomDraws.length, 1);
  assert.equal(result.timeCostT, 3);

  const missState = seedForDraw('surface.river.bear.night', (value) => value >= 0.15);
  const miss = resolveSurfaceAction({
    action: 'night-river-dive', actor: { id: 'r', hitPoints: 10, hunger: 0, sleep: 0, inventory: [] },
    nodeId: 'river', worldTimeT: 30, phase: 'night', actionAvailableAtNode: true, randomState: missState, tables: { fishing, surface, recovered },
  });
  assert.equal(miss.spawnMonsterName, null);
  assert.ok(['普通魚', '名鮭魚', '無收穫'].includes(miss.outcome ?? ''));
  assert.equal(miss.randomDraws.length, 2);
});

test('surface actions gate unknown or disallowed Nodes without charging time or consuming RNG', async () => {
  const [fishing, surface, recovered] = await Promise.all([
    csv('fishing_pool.csv'), csv('surface_exploration.csv'), csv('recovered_surface_actions.csv'),
  ]);
  const base = { action: 'fishing' as const, actor: { id: 'r', hitPoints: 10, hunger: 0, sleep: 0, inventory: [] }, nodeId: 'n', worldTimeT: 4, phase: 'day' as const, randomState: '00000001', tables: { fishing, surface, recovered } };
  const unknown = resolveSurfaceAction({ ...base, actionAvailableAtNode: null });
  assert.equal(unknown.timeCostT, 0);
  assert.equal(unknown.randomDraws.length, 0);
  assert.equal(unknown.unresolved[0]?.sourceId, 'surface-action-node-eligibility');
  const unavailable = resolveSurfaceAction({ ...base, actionAvailableAtNode: false });
  assert.equal(unavailable.timeCostT, 0);
  assert.equal(unavailable.randomDraws.length, 0);
});

test('rock exploration keeps resource and day/night risks in independent source-backed rolls', async () => {
  const [fishing, surface, recovered] = await Promise.all([
    csv('fishing_pool.csv'), csv('surface_exploration.csv'), csv('recovered_surface_actions.csv'),
  ]);
  const nightSeed = Array.from({ length: 100_000 }, (_, index) => (index + 1).toString(16).padStart(8, '0')).find((candidate) => {
    const rng = new SeededRandom(candidate);
    rng.next('resources');
    return rng.next('hp').value < 0.4 && rng.next('sleep').value < 0.25;
  });
  assert.ok(nightSeed !== undefined);
  const result = resolveSurfaceAction({
    action: 'rock-exploration', actor: { id: 'r', hitPoints: 10, hunger: 0, sleep: 2, inventory: [] }, nodeId: 'rock', worldTimeT: 20,
    phase: 'night', actionAvailableAtNode: true, randomState: nightSeed, tables: { fishing, surface, recovered },
  });
  assert.equal(result.randomDraws.length, 3);
  assert.equal(result.actorDelta.hitPoints, -2);
  assert.equal(result.actorDelta.sleep, -1);
});

test('terrain event pool resolver uses the original rows without a sleep-risk normalization layer', () => {
  const table = [
    { id: 'harm', weightPercent: 25, polarity: 'negative' as const },
    { id: 'quiet', weightPercent: 75, polarity: 'nonnegative' as const },
  ];
  const entry = resolveAreaEntryRisk({ table, actorId: 'r', nodeId: 'n', worldTimeT: 0, randomState: '00000001' });
  assert.equal(entry.outcome?.id, 'harm');
  const gated = resolveAreaEntryRisk({ table: null, actorId: 'r', nodeId: 'n', worldTimeT: 3, randomState: '00000001' });
  assert.equal(gated.randomDraws.length, 0);
  assert.ok(gated.unresolved.length > 0);
});

test('coconut stocks need explicit beach IDs, grow once per supplied island day, and cap at three', () => {
  assert.equal(advanceCoconutBeachStocks({ beachNodeIds: null, stockByNode: {}, elapsedIslandDays: 1 }).unresolved[0]?.sourceId, 'coconut-beach-node-ids');
  const grown = advanceCoconutBeachStocks({ beachNodeIds: ['b1', 'b2', 'b3'], stockByNode: { b1: 0, b2: 2, b3: 3 }, elapsedIslandDays: 2 });
  assert.deepEqual(grown.stocks, { b1: 2, b2: 3, b3: 3 });
  assert.equal(grown.unresolved.length, 0);
});

test('coconut harvest decrements natural stock and gives overflow ground coconuts their own 72T lifetime', () => {
  const base = { beachNodeIds: ['b1', 'b2', 'b3'], nodeId: 'b1', stockByNode: { b1: 2, b2: 0, b3: 3 }, inventoryCapacity: 1, worldTimeT: 24, objectId: 'coconut-drop-1' };
  const held = harvestCoconut({ ...base, inventory: [] });
  assert.deepEqual(held.inventory, ['椰子']);
  assert.equal(held.stocks.b1, 1);
  const dropped = harvestCoconut({ ...base, inventory: ['full'] });
  assert.equal(dropped.harvested, true);
  assert.equal(dropped.stocks.b1, 1);
  assert.equal(dropped.createdObjects[0]?.generatedAtT, 24);
  assert.equal(dropped.createdObjects[0]?.expiresAtT, 96);
  assert.equal(dropped.unresolved.length, 0);
  assert.equal(harvestCoconut({ ...base, nodeId: 'unknown', inventory: [] }).harvested, false);
});

test('three uninterrupted night dives or rock explorations award one globally unique hero item', () => {
  const common = { previousAction: 'night-river-dive' as const, previousCount: 2, uninterrupted: true, phase: 'night' as const, actorId: 'r', nodeId: 'n', worldTimeT: 15, existingUniqueItems: [] as readonly string[], rewardObjectId: 'hero-reward-1' };
  const dive = advanceNightExplorationStreak({ ...common, action: 'night-river-dive' });
  assert.equal(dive.rewardItemId, '勇者上甲');
  assert.equal(dive.rewardObject?.expiresAtT, null);
  const rock = advanceNightExplorationStreak({ ...common, previousAction: 'rock-exploration', action: 'rock-exploration' });
  assert.equal(rock.rewardItemId, '勇者盾');
  const duplicate = advanceNightExplorationStreak({ ...common, previousAction: 'rock-exploration', action: 'rock-exploration', existingUniqueItems: ['勇者盾'] });
  assert.equal(duplicate.rewardObject, null);
  assert.equal(advanceNightExplorationStreak({ ...common, previousAction: 'rock-exploration', action: 'rock-exploration', uninterrupted: false }).consecutiveCount, 1);
  assert.equal(advanceNightExplorationStreak({ ...common, previousAction: 'night-river-dive', action: 'rock-exploration' }).consecutiveCount, 1);
  assert.equal(advanceNightExplorationStreak({ ...common, action: 'night-river-dive', phase: 'day' }).consecutiveCount, 0);
});

test('surface encounter source coverage separates forest-specific creatures from all-node night encounters', async () => {
  const monsters = await csv('monsters.csv');
  const summary = summarizeSurfaceEncounterSources(monsters);
  assert.deepEqual(summary.map((entry) => entry.name), ['沙灘螃蟹', '夜間蝙蝠', '山羊', '森林野豬', '電鰻', '夜狼', '河流夜熊']);
  const forestSpecific = summary.filter((entry) => entry.forestSpecific);
  assert.deepEqual(forestSpecific.map((entry) => [entry.name, entry.spawnProbabilityPercent, entry.certainty]), [['森林野豬', null, 'derived_design_from_user_approx_goat']]);
  const allNodeNight = summary.filter((entry) => entry.relevantToNightEncounter);
  assert.deepEqual(allNodeNight.map((entry) => [entry.name, entry.spawnProbabilityPercent]), [['夜間蝙蝠', null], ['夜狼', null]]);
  assert.equal(summary.find((entry) => entry.name === '電鰻')?.spawnProbabilityPercent, 5);
  assert.equal(summary.find((entry) => entry.name === '河流夜熊')?.spawnProbabilityPercent, null);
});
