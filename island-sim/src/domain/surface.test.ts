import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCsv, type CsvRow } from '../content/csv.ts';
import { activeForestBerryPool, forestEntryRates, SURFACE_USER_RULE_OVERRIDES } from '../content/surface-user-overrides.ts';
import { SeededRandom } from '../engine/random.ts';
import { resolveForestEntryEvent, resolveForestSleepRisk } from './forest-risk.ts';
import { advanceCoconutBeachStocks, advanceNightExplorationStreak, harvestCoconut, resolveAreaEntryRisk, resolveSurfaceAction, scaleNegativeAreaRisk, summarizeSurfaceEncounterSources } from './surface.ts';

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
  assert.equal(sum(fishing.filter((row) => row.parent_group === 'junk_20'), 'overall_probability_percent'), 20);
  assert.equal(sum(surface.filter((row) => row.location_action === '河流探索'), 'probability_percent'), 100);
  assert.equal(sum(surface.filter((row) => row.location_action === '岩石探索'), 'probability_percent'), 100);
  assert.equal(sum(surface.filter((row) => row.location_action === '岩石探索_夜間'), 'probability_percent'), 65);
  assert.equal(sum(recovered.filter((row) => row.action === '森林採野莓' && row.status === 'recovered_source_no_known_conflict'), 'probability_percent'), 100);
  assert.equal(recovered.some((row) => row.status === 'historical_superseded_not_active' && (row.action ?? '').startsWith('岩縫')), true);
});

test('latest forest berry override is active 90/10 while recovered CSV remains historical 80/20', async () => {
  const recovered = await csv('recovered_surface_actions.csv');
  const raw = recovered.filter((row) => row.action === '森林採野莓' && row.status === 'recovered_source_no_known_conflict');
  assert.deepEqual(raw.map((row) => [row.result_or_hazard, Number(row.probability_percent)]), [['有益野果', 80], ['無收穫', 20]]);
  assert.deepEqual(activeForestBerryPool().map((row) => [row.outcome, row.probabilityPercent]), [['有益野果', 90], ['無收穫', 10]]);
  const state = seedForDraw('surface.forest.berries', (value) => value >= 0.8 && value < 0.9);
  const result = resolveSurfaceAction({
    action: 'forest-berry-gather', actor: { id: 'r', hitPoints: 10, hunger: 0, sleep: 0, inventory: [] },
    nodeId: 'forest', worldTimeT: 3, phase: 'day', actionAvailableAtNode: true, randomState: state,
    tables: { fishing: [], surface: [], recovered },
  });
  assert.equal(result.outcome, '有益野果');
});

test('forest entry uses trigger then conditional negative pool with the true day/night denominators', () => {
  assert.deepEqual(forestEntryRates('day'), { triggerPercent: 15, negativeGivenTriggerPercent: 35, overallNegativePercent: 5.25 });
  assert.deepEqual(forestEntryRates('night'), { triggerPercent: 25, negativeGivenTriggerPercent: 70, overallNegativePercent: 17.5 });
  const base = { actorId: 'r', nodeId: 'forest', worldTimeT: 1, phase: 'night' as const, isForestNode: true, otherActorsAtNode: [] };
  const conditional = [
    { id: 'negative-row', weightPercent: 70, polarity: 'negative' as const },
    { id: 'other-row', weightPercent: 30, polarity: 'nonnegative' as const },
  ];
  const state = seedForForestEntry('night', 'negative');
  const result = resolveForestEntryEvent({ ...base, conditionalOutcomes: conditional, randomState: state });
  assert.equal(result.category, 'negative');
  assert.equal(result.selectedOutcome?.id, 'negative-row');
  assert.equal(result.event?.payload.outcomeId, 'negative-row');
  assert.equal(result.randomDraws.length, 2);
  assert.equal(result.event?.payload.overallNegativePercent, 17.5);
  assert.deepEqual(result.unresolved, []);
  const triggerMissState = seedForDraw('forest.entry.trigger.forest.r.1', (value) => value >= 0.25);
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

test('unsafe sleep checks use the 17.5% negative total directly once; safe sleep has no check', () => {
  const state = seedForDraw('forest.sleep-risk.forest.r.55', (value) => value >= 0.0525 && value < 0.175);
  const table = [
    { id: 'harm', weightPercent: 70, polarity: 'negative' as const },
    { id: 'quiet', weightPercent: 30, polarity: 'nonnegative' as const },
  ];
  const risk = resolveForestSleepRisk({ actorId: 'r', nodeId: 'forest', worldTimeT: 55, isSafeNode: false, isWilderness: false, table, randomState: state });
  assert.equal(risk.category, 'negative');
  assert.equal(risk.selectedOutcome?.id, 'harm');
  assert.equal(risk.randomDraws.length, 1);
  assert.equal(risk.event?.payload.overallNegativePercent, 17.5);
  assert.ok(risk.unresolved[0]?.sourceId.endsWith(':negative-effect'));
  const safe = resolveForestSleepRisk({ actorId: 'r', nodeId: 'safe', worldTimeT: 55, isSafeNode: true, isWilderness: false, table, randomState: state });
  assert.equal(safe.randomDraws.length, 0);
  assert.equal(safe.rngStateAfter, state);
  const badWildernessBaseline = resolveForestSleepRisk({ actorId: 'r', nodeId: 'forest', worldTimeT: 55, isSafeNode: false, isWilderness: true, table, randomState: state });
  assert.equal(badWildernessBaseline.randomDraws.length, 0);
  assert.equal(badWildernessBaseline.unresolved[0]?.sourceId, `${SURFACE_USER_RULE_OVERRIDES.unsafeSleep.sourceId}:wilderness-baseline`);
  const compiledForestTable = [
    { id: 'harm', weightPercent: 17.5, polarity: 'negative' as const },
    { id: 'no-risk', weightPercent: 82.5, polarity: 'nonnegative' as const },
  ];
  const wilderness = resolveForestSleepRisk({ actorId: 'r', nodeId: 'forest', worldTimeT: 55, isSafeNode: false, isWilderness: true, table: compiledForestTable, randomState: state });
  assert.equal(wilderness.randomDraws.length, 1);
  assert.equal(wilderness.event?.payload.overallNegativePercent, 17.5);
});

test('latest sleep override records safe zero, 3T cadence, eight-check cap, and attack-before-wake order', () => {
  assert.equal(SURFACE_USER_RULE_OVERRIDES.unsafeSleep.safeNodeChecksPerNight, 0);
  assert.equal(SURFACE_USER_RULE_OVERRIDES.unsafeSleep.unsafeCheckEveryT, 3);
  assert.equal(SURFACE_USER_RULE_OVERRIDES.unsafeSleep.maxChecksPerNight, 8);
  assert.equal(SURFACE_USER_RULE_OVERRIDES.unsafeSleep.applyAttackDamageBeforeWake, true);
  assert.equal(SURFACE_USER_RULE_OVERRIDES.unsafeSleep.superseded.safeNodeChecksPerNight, 1);
});

function seedForDraw(sourceId: string, predicate: (value: number) => boolean): string {
  for (let seed = 1; seed < 500_000; seed += 1) {
    const state = seed.toString(16).padStart(8, '0');
    const value = new SeededRandom(state).next(sourceId).value;
    if (predicate(value)) return state;
  }
  throw new Error('No deterministic seed was found for the requested draw range.');
}

function seedForForestEntry(phase: 'day' | 'night', category: 'negative' | 'nonnegative'): string {
  const triggerPercent = phase === 'day' ? 15 : 25;
  const negativePercent = phase === 'day' ? 35 : 70;
  for (let seed = 1; seed < 500_000; seed += 1) {
    const state = seed.toString(16).padStart(8, '0');
    const random = new SeededRandom(state);
    const trigger = random.next(`forest.entry.trigger.forest.r.1`).value;
    const outcome = random.next(`forest.entry.outcome.forest.r.1`).value;
    if (trigger < triggerPercent / 100 && (outcome < negativePercent / 100) === (category === 'negative')) return state;
  }
  throw new Error('No deterministic forest-entry seed found.');
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

test('fishing junk probabilities are conditionalized correctly and hero lower stays unique', async () => {
  const [fishing, surface, recovered] = await Promise.all([
    csv('fishing_pool.csv'), csv('surface_exploration.csv'), csv('recovered_surface_actions.csv'),
  ]);
  const common = { actor: { id: 'r', hitPoints: 10, hunger: 0, sleep: 0, inventory: [] as readonly string[] }, nodeId: 'f', worldTimeT: 0, phase: 'day' as const, actionAvailableAtNode: true, tables: { fishing, surface, recovered } };
  const sourceRows = fishing.filter((row) => row.parent_group === 'junk_20');
  const conditional = sourceRows.map((row) => Number(row.overall_probability_percent) / 20 * 100);
  assert.deepEqual(conditional, [60, 20, 10, 10]);
  const state = Array.from({ length: 100_000 }, (_, index) => (index + 1).toString(16).padStart(8, '0')).find((candidate) => {
    const rng = new SeededRandom(candidate);
    return rng.next('main').value >= 0.98 && rng.next('junk').value >= 0.9;
  });
  assert.ok(state !== undefined);
  const result = resolveSurfaceAction({ ...common, action: 'fishing', randomState: state, existingUniqueItems: ['勇者下甲'] });
  assert.equal(result.timeCostT, 3);
  assert.equal(result.outcome, '勇者下甲');
  assert.equal(result.uniqueItemAlreadyExists, true);
  assert.equal(result.actorDelta.inventory, undefined);
});

test('night dive bears remain gated while the source leaves fish-pool independence unresolved', async () => {
  const [fishing, surface, recovered] = await Promise.all([
    csv('fishing_pool.csv'), csv('surface_exploration.csv'), csv('recovered_surface_actions.csv'),
  ]);
  const result = resolveSurfaceAction({
    action: 'night-river-dive', actor: { id: 'r', hitPoints: 10, hunger: 0, sleep: 0, inventory: [] },
    nodeId: 'river', worldTimeT: 30, phase: 'night', actionAvailableAtNode: true, randomState: '00000001', tables: { fishing, surface, recovered },
  });
  assert.equal(result.unresolved.some((gate) => gate.sourceId === 'surface_exploration.csv:night-river-dive-independence'), true);
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

test('negative area-entry risk scaling preserves internal ratios and gates absent/zero baselines', () => {
  const rows = [
    { id: 'injury', weightPercent: 10, polarity: 'negative' as const },
    { id: 'attack', weightPercent: 5, polarity: 'negative' as const },
    { id: 'finding', weightPercent: 20, polarity: 'nonnegative' as const },
    { id: 'nothing', weightPercent: 65, polarity: 'nonnegative' as const },
  ];
  const scaled = scaleNegativeAreaRisk(rows, 30);
  assert.equal(scaled.entries[0]?.weightPercent, 20);
  assert.equal(scaled.entries[1]?.weightPercent, 10);
  assert.equal(scaled.entries.reduce((n, row) => n + row.weightPercent, 0), 100);
  assert.equal(scaled.entries[2]?.weightPercent, 20 * 70 / 85);
  assert.equal(scaled.entries[3]?.weightPercent, 65 * 70 / 85);
  assert.equal(scaleNegativeAreaRisk(rows, null).unresolved?.sourceId, 'area-entry-negative-baseline');
  assert.equal(scaleNegativeAreaRisk([{ ...rows[2]!, weightPercent: 100 }], 20).unresolved?.sourceId, 'area-entry-negative-sum-zero');
});

test('entry and sleep-risk contexts call one resolver against the supplied source table', () => {
  const table = [
    { id: 'harm', weightPercent: 25, polarity: 'negative' as const },
    { id: 'quiet', weightPercent: 75, polarity: 'nonnegative' as const },
  ];
  const entry = resolveAreaEntryRisk({ context: 'area-entry', table, targetNegativeTotalPercent: 25, actorId: 'r', nodeId: 'n', worldTimeT: 0, randomState: '00000001' });
  const sleep = resolveAreaEntryRisk({ context: 'sleep-risk', table, targetNegativeTotalPercent: 25, actorId: 'r', nodeId: 'n', worldTimeT: 3, randomState: '00000001' });
  assert.equal(entry.outcome?.id, sleep.outcome?.id);
  assert.equal(entry.randomDraws[0]?.value, sleep.randomDraws[0]?.value);
  const gated = resolveAreaEntryRisk({ context: 'sleep-risk', table: null, targetNegativeTotalPercent: null, actorId: 'r', nodeId: 'n', worldTimeT: 3, randomState: '00000001' });
  assert.equal(gated.randomDraws.length, 0);
  assert.ok(gated.unresolved.length > 0);
});

test('coconut stocks need explicit beach IDs, grow once per supplied island day, and cap at three', () => {
  assert.equal(advanceCoconutBeachStocks({ beachNodeIds: null, stockByNode: {}, elapsedIslandDays: 1 }).unresolved[0]?.sourceId, 'coconut-beach-node-ids');
  const grown = advanceCoconutBeachStocks({ beachNodeIds: ['b1', 'b2', 'b3'], stockByNode: { b1: 0, b2: 2, b3: 3 }, elapsedIslandDays: 2 });
  assert.deepEqual(grown.stocks, { b1: 2, b2: 3, b3: 3 });
  assert.equal(grown.unresolved.length, 0);
});

test('coconut harvest decrements natural stock and either adds inventory or a 72T ground object', () => {
  const base = { beachNodeIds: ['b1', 'b2', 'b3'], nodeId: 'b1', stockByNode: { b1: 2, b2: 0, b3: 3 }, inventoryCapacity: 1, worldTimeT: 24, objectId: 'coconut-drop-1' };
  const held = harvestCoconut({ ...base, inventory: [] });
  assert.deepEqual(held.inventory, ['椰子']);
  assert.equal(held.stocks.b1, 1);
  const dropped = harvestCoconut({ ...base, inventory: ['full'] });
  assert.equal(dropped.createdObjects[0]?.itemId, '椰子');
  assert.equal(dropped.createdObjects[0]?.expiresAtT, 96);
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

test('surface encounter source coverage includes all surface creatures and separates forest from all-node night hazards', async () => {
  const monsters = await csv('monsters.csv');
  const summary = summarizeSurfaceEncounterSources(monsters);
  assert.deepEqual(summary.map((entry) => entry.name), ['沙灘螃蟹', '夜間蝙蝠', '山羊', '森林野豬', '電鰻', '夜狼', '河流夜熊']);
  const forestSpecific = summary.filter((entry) => entry.forestSpecific);
  assert.deepEqual(forestSpecific.map((entry) => [entry.name, entry.spawnProbabilityPercent, entry.certainty]), [['森林野豬', null, 'derived_design_from_user_approx_goat']]);
  const allNodeNight = summary.filter((entry) => entry.relevantToForest && !entry.forestSpecific);
  assert.deepEqual(allNodeNight.map((entry) => [entry.name, entry.spawnProbabilityPercent]), [['夜間蝙蝠', null], ['夜狼', null]]);
  assert.equal(summary.find((entry) => entry.name === '電鰻')?.spawnProbabilityPercent, 5);
  assert.equal(summary.find((entry) => entry.name === '河流夜熊')?.spawnProbabilityPercent, 5);
});
