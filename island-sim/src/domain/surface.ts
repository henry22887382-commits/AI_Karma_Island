import type { CsvRow } from '../content/csv.ts';
import { activeForestBerryPool } from '../content/surface-user-overrides.ts';
import { SURFACE_USER_RULE_OVERRIDES } from '../content/surface-user-overrides.ts';
import { SeededRandom } from '../engine/random.ts';
import type { JsonValue, RandomDraw, WorldObject } from './model.ts';

export type SurfaceAction = 'fishing' | 'river-exploration' | 'night-river-dive' | 'rock-exploration' | 'forest-berry-gather';

const surfaceActions: readonly SurfaceAction[] = [
  'fishing', 'river-exploration', 'night-river-dive', 'rock-exploration', 'forest-berry-gather',
];

export function isSurfaceAction(value: string): value is SurfaceAction {
  return surfaceActions.some((action) => action === value);
}

export type RiskPolarity = 'negative' | 'nonnegative';

export interface AreaRiskEntry {
  readonly id: string;
  readonly weightPercent: number;
  readonly polarity: RiskPolarity;
  readonly payload?: JsonValue;
}

export interface SurfaceActorInput {
  readonly id: string;
  readonly hitPoints: number;
  readonly hunger: number;
  readonly sleep: number;
  readonly inventory: readonly string[];
}

export interface SurfaceTables {
  readonly fishing: readonly CsvRow[];
  readonly surface: readonly CsvRow[];
  readonly recovered: readonly CsvRow[];
  readonly monsters?: readonly CsvRow[];
}

export interface SurfaceEncounterSourceSummary {
  readonly name: string;
  readonly region: string;
  readonly spawnAreaTag: string;
  readonly spawnTrigger: string;
  readonly spawnProbabilityPercent: number | null;
  readonly certainty: string;
  readonly relevantToNightEncounter: boolean;
  readonly forestSpecific: boolean;
}

/** Lists source surface creatures without deriving missing encounter probabilities. */
export function summarizeSurfaceEncounterSources(monsters: readonly CsvRow[]): readonly SurfaceEncounterSourceSummary[] {
  return monsters.filter((row) => row.region === 'surface').map((row) => {
    const area = row.spawn_area_tag ?? '';
    const probability = row.spawn_probability_percent;
    const spawnProbabilityPercent = probability === undefined || probability === '' ? null : requiredNumber(probability, 'spawn_probability_percent');
    const forestSpecific = area.includes('森林');
    const relevantToNightEncounter = area.includes('所有未受有效點燃營火保護');
    return {
      name: required(row, 'name'), region: required(row, 'region'), spawnAreaTag: area,
      spawnTrigger: required(row, 'spawn_trigger'), spawnProbabilityPercent,
      certainty: required(row, 'certainty'), relevantToNightEncounter, forestSpecific,
    };
  });
}

export interface SurfaceUnresolvedGate {
  readonly sourceId: string;
  readonly detail: string;
}

export interface SurfaceEventDraft {
  readonly kind: string;
  readonly actorId: string;
  readonly nodeId: string;
  readonly worldTimeT: number;
  readonly visibility: 'public' | 'private' | 'player-only';
  readonly payload: JsonValue;
  readonly randomDraws: readonly RandomDraw[];
}

export interface SurfaceActionResult {
  readonly action: SurfaceAction;
  readonly timeCostT: 0 | 3;
  readonly outcome: string | null;
  readonly spawnMonsterName: string | null;
  readonly actorDelta: Readonly<{ hitPoints?: number; hunger?: number; sleep?: number; inventory?: readonly string[] }>;
  readonly createdObjects: readonly WorldObject[];
  readonly events: readonly SurfaceEventDraft[];
  readonly randomDraws: readonly RandomDraw[];
  readonly rngStateAfter: string;
  readonly unresolved: readonly SurfaceUnresolvedGate[];
  readonly uniqueItemAlreadyExists: boolean;
}

export interface CoconutStockResult {
  readonly stocks: Readonly<Record<string, number>>;
  readonly unresolved: readonly SurfaceUnresolvedGate[];
}

export function advanceCoconutBeachStocks(input: {
  readonly beachNodeIds: readonly string[] | null;
  readonly stockByNode: Readonly<Record<string, number>>;
  readonly elapsedIslandDays: number;
}): CoconutStockResult {
  const gated = validateCoconutBeachIds(input.beachNodeIds);
  if (gated !== null) return { stocks: input.stockByNode, unresolved: [gated] };
  if (!Number.isSafeInteger(input.elapsedIslandDays) || input.elapsedIslandDays < 0) throw new RangeError('Elapsed island days must be a nonnegative integer.');
  const ids = input.beachNodeIds as readonly string[];
  if (ids.some((id) => input.stockByNode[id] === undefined)) return { stocks: input.stockByNode, unresolved: [{ sourceId: 'coconut-initial-stock', detail: 'Initial stock is not supplied for all three explicit coconut beach Node IDs.' }] };
  const stocks: Record<string, number> = {};
  for (const id of ids) {
    const stock = input.stockByNode[id];
    if (stock === undefined || !Number.isInteger(stock) || stock < 0 || stock > 3) throw new RangeError(`Coconut stock for ${id} must be an integer from 0 to 3.`);
    stocks[id] = Math.min(3, stock + input.elapsedIslandDays);
  }
  return { stocks, unresolved: [] };
}

export interface CoconutHarvestResult {
  readonly harvested: boolean;
  readonly stocks: Readonly<Record<string, number>>;
  readonly inventory: readonly string[];
  readonly createdObjects: readonly WorldObject[];
  readonly unresolved: readonly SurfaceUnresolvedGate[];
}

export function harvestCoconut(input: {
  readonly beachNodeIds: readonly string[] | null;
  readonly nodeId: string;
  readonly stockByNode: Readonly<Record<string, number>>;
  readonly inventory: readonly string[];
  readonly inventoryCapacity: number;
  readonly worldTimeT: number;
  readonly objectId: string;
}): CoconutHarvestResult {
  const gated = validateCoconutBeachIds(input.beachNodeIds);
  if (gated !== null) return { harvested: false, stocks: input.stockByNode, inventory: input.inventory, createdObjects: [], unresolved: [gated] };
  const ids = input.beachNodeIds as readonly string[];
  if (!ids.includes(input.nodeId)) return { harvested: false, stocks: input.stockByNode, inventory: input.inventory, createdObjects: [], unresolved: [{ sourceId: 'coconut-beach-node', detail: 'The current Node is not among the three source-backed explicit coconut beach IDs.' }] };
  const stock = input.stockByNode[input.nodeId];
  if (stock === undefined) return { harvested: false, stocks: input.stockByNode, inventory: input.inventory, createdObjects: [], unresolved: [{ sourceId: 'coconut-initial-stock', detail: 'Current coconut beach stock is not supplied.' }] };
  if (!Number.isInteger(stock) || stock < 0 || stock > 3) throw new RangeError('Coconut stock must be an integer from 0 to 3.');
  if (stock === 0) return { harvested: false, stocks: input.stockByNode, inventory: input.inventory, createdObjects: [], unresolved: [] };
  if (!Number.isSafeInteger(input.worldTimeT) || input.worldTimeT < 0 || !Number.isSafeInteger(input.inventoryCapacity) || input.inventoryCapacity < 0) throw new RangeError('World time and inventory capacity must be nonnegative integers.');
  if (input.inventory.length >= input.inventoryCapacity) {
    const stocks = { ...input.stockByNode, [input.nodeId]: stock - 1 };
    return {
      harvested: true, stocks, inventory: input.inventory, unresolved: [],
      createdObjects: [{ id: input.objectId, itemId: '椰子', objectType: 'item', ownerActorId: null, nodeId: input.nodeId, generatedAtT: input.worldTimeT, expiresAtT: input.worldTimeT + 72, unique: false, provisional: false }],
    };
  }
  const stocks = { ...input.stockByNode, [input.nodeId]: stock - 1 };
  return { harvested: true, stocks, inventory: [...input.inventory, '椰子'], createdObjects: [], unresolved: [] };
}

export interface NightExplorationStreakResult {
  readonly consecutiveCount: number;
  readonly rewardItemId: '勇者上甲' | '勇者盾' | null;
  readonly rewardObject: WorldObject | null;
}

export function advanceNightExplorationStreak(input: {
  readonly action: 'night-river-dive' | 'rock-exploration' | null;
  readonly previousAction: 'night-river-dive' | 'rock-exploration' | null;
  readonly previousCount: number;
  readonly uninterrupted: boolean;
  readonly phase: 'day' | 'night';
  readonly actorId: string;
  readonly nodeId: string;
  readonly worldTimeT: number;
  readonly existingUniqueItems: readonly string[];
  readonly rewardObjectId: string;
}): NightExplorationStreakResult {
  if (!Number.isInteger(input.previousCount) || input.previousCount < 0) throw new RangeError('Exploration streak count must be a nonnegative integer.');
  const consecutiveCount = input.phase !== 'night' || input.action === null ? 0
    : input.uninterrupted && input.previousAction === input.action ? input.previousCount + 1 : 1;
  const rewardItemId = consecutiveCount === 3 ? (input.action === 'night-river-dive' ? '勇者上甲' : input.action === 'rock-exploration' ? '勇者盾' : null) : null;
  if (rewardItemId === null || input.existingUniqueItems.includes(rewardItemId)) return { consecutiveCount, rewardItemId: null, rewardObject: null };
  const rewardObject: WorldObject = { id: input.rewardObjectId, itemId: rewardItemId, objectType: 'item', remainsActorId: null, ownerActorId: null, nodeId: input.nodeId, generatedAtT: input.worldTimeT, expiresAtT: null, unique: true, provisional: false };
  return { consecutiveCount, rewardItemId, rewardObject };
}

function validateCoconutBeachIds(ids: readonly string[] | null): SurfaceUnresolvedGate | null {
  if (ids === null) return { sourceId: 'coconut-beach-node-ids', detail: 'The three coconut beach Node IDs remain unspecified by the source; supply all three explicitly.' };
  if (ids.length !== 3 || new Set(ids).size !== 3 || ids.some((id) => id.length === 0)) return { sourceId: 'coconut-beach-node-ids', detail: 'Exactly three distinct, non-empty source-confirmed coconut beach Node IDs are required.' };
  return null;
}

export function resolveSurfaceAction(input: {
  readonly action: SurfaceAction;
  readonly actor: SurfaceActorInput;
  readonly nodeId: string;
  readonly worldTimeT: number;
  readonly phase: 'day' | 'night';
  readonly actionAvailableAtNode: boolean | null;
  readonly randomState: string;
  readonly tables: SurfaceTables;
  readonly existingUniqueItems?: readonly string[];
  readonly inventoryCapacity?: number;
  readonly objectId?: string;
}): SurfaceActionResult {
  const random = new SeededRandom(input.randomState);
  if (!input.nodeId) throw new Error('A Node ID is required for a surface action.');
  if (input.actionAvailableAtNode === null) return emptySurfaceAction(input, random.stateHex, [{ sourceId: 'surface-action-node-eligibility', detail: `The source does not identify exact Node IDs for ${input.action}; eligibility must be supplied by an authoritative mapping.` }]);
  if (!input.actionAvailableAtNode || (input.action === 'night-river-dive' && input.phase !== 'night')) return emptySurfaceAction(input, random.stateHex, []);
  const draws: RandomDraw[] = [];
  const unresolved: SurfaceUnresolvedGate[] = [];
  const actorDelta: { hitPoints?: number; hunger?: number; sleep?: number; inventory?: readonly string[] } = {};
  let outcome: string | null = null;
  let spawnMonsterName: string | null = null;

  const drawFrom = (rows: readonly CsvRow[], weightColumn: string, sourceId: string): CsvRow => {
    const entries = rows.map((row) => ({ row, weight: requiredNumber(row[weightColumn], weightColumn) }));
    assertPercentTotal(entries.map(({ weight }) => weight), sourceId);
    const draw = random.next(sourceId);
    draws.push(draw);
    return selectWeighted(entries, draw.value).row;
  };

  if (input.action === 'fishing') {
    const main = input.tables.fishing.filter((row) => row.parent_group === 'main');
    const selected = drawFrom(main, 'overall_probability_percent', 'surface.fishing.main');
    outcome = required(selected, 'outcome');
    if (outcome === '電鰻') spawnMonsterName = '電鰻';
  } else if (input.action === 'river-exploration' || input.action === 'night-river-dive') {
    const bearAction = input.phase === 'night' ? '河流探索_夜間' : '河流探索_白天';
    const bear = input.tables.surface.find((row) => row.location_action === bearAction && row.result_or_hazard === '河流夜熊');
    let bearEncountered = false;
    if (bear !== undefined) {
      const draw = random.next(`surface.river.bear.${input.phase}`);
      draws.push(draw);
      bearEncountered = draw.value < requiredNumber(bear.probability_percent, 'probability_percent') / 100;
    }
    if (bearEncountered) {
      outcome = '河流夜熊';
      spawnMonsterName = '河流夜熊';
    } else {
      const rows = input.tables.surface.filter((row) => row.location_action === '河流探索');
      outcome = required(drawFrom(rows, 'probability_percent', 'surface.river.exploration'), 'result_or_hazard');
    }
  } else if (input.action === 'rock-exploration') {
    const resources = input.tables.surface.filter((row) => row.location_action === '岩石探索');
    outcome = required(drawFrom(resources, 'probability_percent', 'surface.rock.resources'), 'result_or_hazard');
    const riskRows = input.tables.surface.filter((row) => row.location_action === (input.phase === 'night' ? '岩石探索_夜間' : '岩石探索_白天'));
    for (const risk of riskRows) {
      const draw = random.next(`surface.rock.risk.${input.phase}.${required(risk, 'result_or_hazard')}`);
      draws.push(draw);
      const probability = requiredNumber(risk.probability_percent, 'probability_percent');
      if (draw.value < probability / 100) {
        const effect = required(risk, 'outcome');
        if (effect.startsWith('hp')) actorDelta.hitPoints = (actorDelta.hitPoints ?? 0) + parseEffectDelta(effect);
        else if (effect.startsWith('sleep')) actorDelta.sleep = (actorDelta.sleep ?? 0) + parseEffectDelta(effect);
      }
    }
  } else {
    const rawRows = input.tables.recovered.filter((row) => row.action === '森林採野莓' && row.status === 'user_confirmed_active_2026-10-22');
    const activePool = activeForestBerryPool();
    const rows = rawRows.map((row) => {
      const override = activePool.find((entry) => entry.outcome === row.result_or_hazard);
      return override === undefined ? row : { ...row, probability_percent: String(override.probabilityPercent) };
    });
    outcome = required(drawFrom(rows, 'probability_percent', 'surface.forest.berries'), 'result_or_hazard');
  }

  const award = isSurfaceItemOutcome(input.action, outcome);
  const uniqueItemAlreadyExists = outcome === '勇者下甲' && ((input.existingUniqueItems ?? []).includes(outcome) || input.actor.inventory.includes(outcome));
  const createdObjects: WorldObject[] = [];
  if (award && !uniqueItemAlreadyExists) {
    const capacity = input.inventoryCapacity ?? 10;
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError('Inventory capacity must be a nonnegative integer.');
    if (input.actor.inventory.length < capacity) actorDelta.inventory = [...input.actor.inventory, outcome];
    else if (input.objectId === undefined || input.objectId.length === 0) unresolved.push({ sourceId: 'surface-item-overflow-object-id', detail: `Outcome ${outcome} was earned while inventory is full; a stable ground-object ID is required.` });
    else createdObjects.push({
      id: input.objectId, itemId: outcome, objectType: 'item', remainsActorId: null, ownerActorId: null,
      nodeId: input.nodeId, generatedAtT: input.worldTimeT,
      expiresAtT: outcome === '勇者下甲' ? null : input.worldTimeT + 72,
      unique: outcome === '勇者下甲', provisional: false,
    });
  }

  const randomDraws = [...draws];
  const payload: JsonValue = { action: input.action, outcome, actorDelta, uniqueItemAlreadyExists, spawnMonsterName };
  const events: SurfaceEventDraft[] = outcome === null ? [] : [{
    kind: 'surface-action-resolved', actorId: input.actor.id, nodeId: input.nodeId, worldTimeT: input.worldTimeT,
    visibility: 'player-only', payload, randomDraws,
  }];
  return {
    action: input.action, timeCostT: 3, outcome, spawnMonsterName, actorDelta, createdObjects, events, randomDraws,
    rngStateAfter: random.stateHex, unresolved, uniqueItemAlreadyExists,
  };
}

function emptySurfaceAction(input: { readonly action: SurfaceAction; readonly actor: SurfaceActorInput; readonly nodeId: string; readonly worldTimeT: number }, rngState: string, unresolved: readonly SurfaceUnresolvedGate[]): SurfaceActionResult {
  return { action: input.action, timeCostT: 0, outcome: null, spawnMonsterName: null, actorDelta: {}, createdObjects: [], events: [], randomDraws: [], rngStateAfter: rngState, unresolved, uniqueItemAlreadyExists: false };
}

function isSurfaceItemOutcome(action: SurfaceAction, outcome: string | null): outcome is string {
  if (outcome === null) return false;
  if (action === 'fishing') return !['空竿', '電鰻', '雜物總計'].includes(outcome);
  if (action === 'river-exploration' || action === 'night-river-dive') return ['普通魚', '名鮭魚'].includes(outcome);
  if (action === 'rock-exploration') return ['魔法石', '寶箱'].includes(outcome);
  return outcome === '有益野果';
}

export interface AreaEntryRiskResult {
  readonly outcome: AreaRiskEntry | null;
  readonly randomDraws: readonly RandomDraw[];
  readonly rngStateAfter: string;
  readonly unresolved: readonly SurfaceUnresolvedGate[];
}

export interface SurfaceEntryResult {
  readonly terrain: 'beach' | 'forest' | 'river' | 'rock';
  readonly triggered: boolean;
  readonly triggerPercent: number;
  readonly overallOutcomePercent: number | null;
  readonly outcome: CsvRow | null;
  readonly randomDraws: readonly RandomDraw[];
  readonly rngStateAfter: string;
}

/** Resolves a source-backed terrain entry pool after the caller has checked occupancy and night-enemy priority. */
export function resolveSurfaceEntry(input: {
  readonly terrain: SurfaceEntryResult['terrain'];
  readonly phase: 'day' | 'night';
  readonly rows: readonly CsvRow[];
  readonly actorId: string;
  readonly nodeId: string;
  readonly worldTimeT: number;
  readonly randomState: string;
}): SurfaceEntryResult {
  const random = new SeededRandom(input.randomState);
  const triggerPercent = input.phase === 'day'
    ? SURFACE_USER_RULE_OVERRIDES.entry.triggerPercentByTerrain[input.terrain]
    : SURFACE_USER_RULE_OVERRIDES.entry.nightTriggerPercentByTerrain[input.terrain];
  const pool = input.rows.filter((row) => row.terrain === input.terrain);
  if (pool.length === 0) throw new Error(`No surface-entry outcome rows exist for ${input.terrain}.`);
  const entries = pool.map((row) => ({ row, weight: requiredNumber(row.probability_percent, 'probability_percent') }));
  assertPercentTotal(entries.map(({ weight }) => weight), `Surface entry ${input.terrain}`);
  const trigger = random.next(`surface.entry.trigger.${input.phase}.${input.terrain}.${input.nodeId}.${input.actorId}.${input.worldTimeT}`);
  if (trigger.value >= triggerPercent / 100) return { terrain: input.terrain, triggered: false, triggerPercent, overallOutcomePercent: null, outcome: null, randomDraws: [trigger], rngStateAfter: random.stateHex };
  const outcomeDraw = random.next(`surface.entry.outcome.${input.terrain}.${input.nodeId}.${input.actorId}.${input.worldTimeT}`);
  const outcome = selectWeighted(entries, outcomeDraw.value).row;
  const enemyMissPercent = input.phase === 'night' ? 100 - SURFACE_USER_RULE_OVERRIDES.nightEncounter.encounterPercentByTerrain[input.terrain] : 100;
  return { terrain: input.terrain, triggered: true, triggerPercent, overallOutcomePercent: enemyMissPercent * triggerPercent * Number(outcome.probability_percent) / 10000, outcome, randomDraws: [trigger, outcomeDraw], rngStateAfter: random.stateHex };
}

/** Resolve an original terrain event pool without importing night encounter or sleep probabilities. */
export function resolveAreaEntryRisk(input: {
  readonly table: readonly AreaRiskEntry[] | null;
  readonly actorId: string;
  readonly nodeId: string;
  readonly worldTimeT: number;
  readonly randomState: string;
}): AreaEntryRiskResult {
  const random = new SeededRandom(input.randomState);
  if (input.table === null) return { outcome: null, randomDraws: [], rngStateAfter: random.stateHex, unresolved: [{ sourceId: 'area-entry-table', detail: 'No source-backed area-entry risk table was supplied.' }] };
  validateAreaRisk(input.table);
  const draw = random.next(`surface.area-entry-risk.${input.nodeId}.${input.actorId}.${input.worldTimeT}`);
  return { outcome: selectWeighted(input.table.map((entry) => ({ row: entry, weight: entry.weightPercent })), draw.value).row, randomDraws: [draw], rngStateAfter: random.stateHex, unresolved: [] };
}

function validateAreaRisk(entries: readonly AreaRiskEntry[]): void {
  if (entries.length === 0) throw new Error('Area-entry risk table must not be empty.');
  if (entries.some((entry) => !entry.id || !Number.isFinite(entry.weightPercent) || entry.weightPercent < 0)) throw new RangeError('Area-entry risk rows require IDs and nonnegative finite weights.');
  assertPercentTotal(entries.map((entry) => entry.weightPercent), 'Area-entry risk table');
}

function parseEffectDelta(effect: string): number {
  const match = /(?:hp|sleep)([+-]\d+)/.exec(effect);
  if (match?.[1] === undefined) throw new Error(`Unsupported surface effect ${effect}.`);
  return Number(match[1]);
}

function required(row: CsvRow, column: string): string {
  const value = row[column];
  if (value === undefined || value.length === 0) throw new Error(`Missing source field ${column}.`);
  return value;
}

function requiredNumber(value: string | undefined, column: string): number {
  if (value === undefined || value === '') throw new Error(`Missing numeric source field ${column}.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid numeric source field ${column}: ${value}.`);
  return number;
}

function assertPercentTotal(values: readonly number[], label: string): void {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) > 1e-9) throw new Error(`${label} totals ${total}%, expected 100%.`);
}

function selectWeighted<T>(entries: readonly { readonly row: T; readonly weight: number }[], randomValue: number): { readonly row: T; readonly weight: number } {
  let threshold = randomValue * 100;
  for (const entry of entries) {
    threshold -= entry.weight;
    if (threshold < 0) return entry;
  }
  const last = entries.at(-1);
  if (last === undefined) throw new Error('Cannot draw from an empty weighted pool.');
  return last;
}
