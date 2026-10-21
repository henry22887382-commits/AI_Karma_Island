import type { CsvRow } from '../content/csv.ts';
import { SeededRandom } from '../engine/random.ts';
import type { RandomDraw, WorldObject } from './model.ts';

export interface UnresolvedGate {
  readonly sourceId: string;
  readonly detail: string;
}

export interface DungeonEventResult {
  readonly event: CsvRow | null;
  readonly randomDraws: readonly RandomDraw[];
  readonly rngStateAfter: string;
  readonly unresolved: UnresolvedGate | null;
}

export const dungeonFloorNames = ['雨林', '溫泉下水道', '火山洞窟'] as const;
export const volcanicBombNodes = ['A1', 'B1', 'C1'] as const;
export const dungeonEventExpiryT = 72;

/** Draw the guaranteed single main event only when the caller confirms an empty non-Boss Node. */
export function drawDungeonEvent(input: {
  readonly floor: string;
  readonly nodeId: string;
  readonly events: readonly CsvRow[];
  readonly random: SeededRandom;
  readonly eligibleEmptyNonBossNode?: boolean;
}): DungeonEventResult {
  const rngStateAfter = input.random.stateHex;
  if (input.eligibleEmptyNonBossNode === false) {
    return { event: null, randomDraws: [], rngStateAfter, unresolved: null };
  }
  const rows = input.events.filter((row) => row.floor === input.floor);
  if (rows.length === 0) {
    return {
      event: null,
      randomDraws: [],
      rngStateAfter,
      unresolved: { sourceId: 'dungeon-events', detail: `No event rows are available for floor ${input.floor}.` },
    };
  }
  const volcanicBomb = rows.find((row) => row.event === '火山彈');
  if (volcanicBomb !== undefined && !volcanicBombNodes.includes(input.nodeId as (typeof volcanicBombNodes)[number])) {
    return {
      event: null,
      randomDraws: [],
      rngStateAfter,
      unresolved: {
        sourceId: 'D-007',
        detail: 'The source restricts volcanic bombs to A1/B1/C1 but does not specify how the removed 8% is allocated elsewhere on floor three.',
      },
    };
  }
  const entries = rows.map((row) => ({ row, weight: requiredNumber(row.probability_percent, 'probability_percent') }));
  assertPercentTotal(entries.map((entry) => entry.weight), `Dungeon event pool ${input.floor}`);
  const draw = input.random.next(`dungeon.event.${input.floor}.${input.nodeId}`);
  const event = selectWeighted(entries, draw.value).row;
  return { event, randomDraws: [draw], rngStateAfter: input.random.stateHex, unresolved: null };
}

/** Wet-slippery-waterway is an additional encounter after its main event, not part of the 50% monster split. */
export function requiresSlimeWaterwayEncounter(eventName: string): boolean {
  return eventName === '濕滑水道';
}

export interface BonusDropResult {
  readonly item: string | null;
  readonly randomDraw: RandomDraw;
}

/** One mutually exclusive extra-drop roll; guaranteed hero sword logic is intentionally separate. */
export function drawMonsterBonusDrop(input: {
  readonly monster: string;
  readonly rows: readonly CsvRow[];
  readonly random: SeededRandom;
}): BonusDropResult {
  const row = input.rows.find((candidate) => candidate.monster === input.monster);
  if (row === undefined) throw new Error(`No recovered extra-drop row for ${input.monster}.`);
  const itemColumns = [
    ['紙筆_percent', '紙筆'],
    ['告示牌_percent', '告示牌'],
    ['炸彈_percent', '炸彈'],
    ['營火_percent', '營火'],
  ] as const;
  const entries: { readonly item: string | null; readonly weight: number }[] = itemColumns.map(([column, item]) => ({ item, weight: requiredNumber(row[column], column) }))
    .filter((entry) => entry.weight > 0);
  entries.push({ item: null, weight: requiredNumber(row.no_extra_drop_percent, 'no_extra_drop_percent') });
  assertPercentTotal(entries.map((entry) => entry.weight), `Bonus drops ${input.monster}`);
  const randomDraw = input.random.next(`monster.bonus-drop.${input.monster}`);
  return { item: selectWeighted(entries, randomDraw.value).item, randomDraw };
}

export interface ContainerDrawResult {
  readonly item: string;
  readonly category: string;
  readonly provisional: true;
  readonly status: 'recovered_user_source_provisional_one_item';
  readonly randomDraws: readonly RandomDraw[];
  readonly rngStateAfter: string;
}

/** Apply the recovered two-stage candidate pool while keeping its one-item assumption explicitly provisional. */
export function drawContainerItem(input: {
  readonly source: string;
  readonly categoryWeights: readonly CsvRow[];
  readonly subpools: readonly CsvRow[];
  readonly random: SeededRandom;
}): ContainerDrawResult {
  const categoryRows = input.categoryWeights.filter((row) => row.source === input.source);
  const categories = categoryRows.map((row) => ({
    category: requiredText(row.category, 'category'),
    weight: requiredNumber(row.category_percent, 'category_percent'),
  }));
  assertPercentTotal(categories.map((entry) => entry.weight), `Container categories ${input.source}`);
  const categoryDraw = input.random.next(`container.category.${input.source}`);
  const category = selectWeighted(categories, categoryDraw.value).category;
  const itemRows = input.subpools.filter((row) => row.source === input.source && row.category === category);
  const items = itemRows.map((row) => ({
    item: requiredText(row.item, 'item'),
    weight: requiredNumber(row.within_category_percent, 'within_category_percent'),
  }));
  assertPercentTotal(items.map((entry) => entry.weight), `Container items ${input.source}/${category}`);
  const itemDraw = input.random.next(`container.item.${input.source}.${category}`);
  return {
    item: selectWeighted(items, itemDraw.value).item,
    category,
    provisional: true,
    status: 'recovered_user_source_provisional_one_item',
    randomDraws: [categoryDraw, itemDraw],
    rngStateAfter: input.random.stateHex,
  };
}

/** A unique copy can return to its source only when no usable copy exists in inventories or world objects. */
export function canRespawnUniqueItem(
  itemId: string,
  objects: readonly WorldObject[],
  heldUniqueItemIds: readonly string[],
  currentT = 0,
): boolean {
  if (heldUniqueItemIds.includes(itemId)) return false;
  return !objects.some((object) => object.itemId === itemId &&
    (object.expiresAtT === null || object.expiresAtT > currentT));
}

export function createDropObject(input: {
  readonly id: string;
  readonly itemId: string;
  readonly nodeId: string | null;
  readonly ownerActorId?: string | null;
  readonly generatedAtT: number;
  readonly unique?: boolean;
  readonly provisional?: boolean;
}): WorldObject {
  if (!Number.isInteger(input.generatedAtT) || input.generatedAtT < 0) {
    throw new RangeError('Drop generation time must be a non-negative integer T.');
  }
  const unique = input.unique ?? false;
  return {
    id: input.id,
    itemId: input.itemId,
    ownerActorId: input.ownerActorId ?? null,
    nodeId: input.nodeId,
    generatedAtT: input.generatedAtT,
    expiresAtT: unique ? null : input.generatedAtT + dungeonEventExpiryT,
    unique,
    provisional: input.provisional ?? false,
  };
}

function selectWeighted<T extends { readonly weight: number }>(entries: readonly T[], value: number): T {
  let boundary = 0;
  for (const entry of entries) {
    boundary += entry.weight / 100;
    if (value < boundary) return entry;
  }
  return entries.at(-1)!;
}

function assertPercentTotal(weights: readonly number[], label: string): void {
  if (weights.length === 0 || weights.some((weight) => !Number.isFinite(weight) || weight < 0) ||
    Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) > 1e-8) {
    throw new Error(`${label} must contain a complete, non-negative 100% distribution.`);
  }
}

function requiredNumber(value: string | undefined, column: string): number {
  if (value === undefined || value.trim() === '') throw new Error(`Source column ${column} is unresolved.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Source column ${column} must be finite.`);
  return parsed;
}

function requiredText(value: string | undefined, column: string): string {
  if (value === undefined || value.trim() === '') throw new Error(`Source column ${column} is unresolved.`);
  return value;
}
