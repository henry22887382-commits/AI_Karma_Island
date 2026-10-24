import type { CsvRow } from '../content/csv.ts';
import { drawDungeonEvent, requiresSlimeWaterwayEncounter } from '../domain/dungeon.ts';
import type { DungeonEncounterState, DungeonRuntimeState, JsonValue, RandomDraw, WorldObject } from '../domain/model.ts';
import { SeededRandom } from './random.ts';
export type { DungeonEncounterState, DungeonRuntimeState } from '../domain/model.ts';

/** Shared layout supplied by the user: S branches through A/B/C to E on every floor. */
export const DUNGEON_CELL_IDS = ['S', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'E'] as const;
export const DUNGEON_ENTRY_CELL_ID = 'S' as const;
export const DUNGEON_BOSS_CELL_ID = 'E' as const;

const DUNGEON_NEIGHBORS: Readonly<Record<(typeof DUNGEON_CELL_IDS)[number], readonly string[]>> = {
  S: ['A1', 'B1', 'C1'],
  A1: ['S', 'A2'],
  A2: ['A1', 'E'],
  B1: ['S', 'B2'],
  B2: ['B1', 'E'],
  C1: ['S', 'C2'],
  C2: ['C1', 'E'],
  E: ['A2', 'B2', 'C2'],
};

const DUNGEON_CONTAINER_SOURCE_BY_EVENT: Readonly<Record<string, string>> = {
  '雨林|遺失背包': '第一層遺失背包',
  '雨林|森林寶箱': '第一層林中寶箱',
  '溫泉下水道|漂流背包': '第二層漂流背包',
  '溫泉下水道|生鏽寶箱': '第二層生鏽寶箱',
  '火山洞窟|遠古寶箱': '第三層古老寶箱',
};

/** Keeps the event's display name intact while linking only explicit 07A container sources. */
export function dungeonContainerSourceId(floorName: string, eventName: string): string | null {
  return DUNGEON_CONTAINER_SOURCE_BY_EVENT[`${floorName}|${eventName}`] ?? null;
}

/** Each floor uses the same cell IDs and adjacency; floor is validated to prevent unknown layers. */
export function dungeonCellNeighbors(floor: number, cellId: string): readonly string[] {
  if (!Number.isInteger(floor) || floor < 1 || floor > 3) return [];
  return DUNGEON_NEIGHBORS[cellId as keyof typeof DUNGEON_NEIGHBORS] ?? [];
}

export function isDungeonBossCell(cellId: string): boolean {
  return cellId === DUNGEON_BOSS_CELL_ID;
}

export interface DungeonEventDraft {
  readonly eventId: string;
  readonly worldTimeT: number;
  readonly actorId: string;
  readonly nodeId: string;
  readonly kind: 'dungeon-cell-event' | 'dungeon-encounter-started';
  readonly visibility: 'public';
  readonly payload: JsonValue;
  readonly randomDraws: readonly RandomDraw[];
}

export interface DungeonRuntimeStepResult {
  readonly nextDungeonState: DungeonRuntimeState;
  readonly eventDrafts: readonly DungeonEventDraft[];
  readonly createdObjects: readonly WorldObject[];
  readonly randomDraws: readonly RandomDraw[];
  readonly unresolved: readonly { readonly sourceId: string; readonly detail: string }[];
}

export interface DungeonRuntimeAction {
  readonly kind: 'enter-cell';
  readonly fromCellId: string;
  readonly toCellId: string;
  readonly isBossCell: boolean;
  readonly otherLivingResidentPresent: boolean;
  readonly isRetreat?: boolean;
}

export function resolveDungeonRuntimeStep(input: {
  readonly state: DungeonRuntimeState;
  readonly actorId: string;
  readonly worldTimeT: number;
  readonly action: DungeonRuntimeAction;
  readonly events: readonly CsvRow[];
  readonly random: SeededRandom;
  readonly ids: { readonly eventId: string; readonly encounterId: string };
  readonly forceEventNameForTest?: string;
}): DungeonRuntimeStepResult {
  const { state, action } = input;
  const expectedFromCell = state.cellByActorId[input.actorId];
  const isEntry = expectedFromCell === undefined && action.fromCellId === '' && action.toCellId === DUNGEON_ENTRY_CELL_ID;
  if (!isEntry && (expectedFromCell !== action.fromCellId || !dungeonCellNeighbors(state.activeFloor, action.fromCellId).includes(action.toCellId))) {
    return {
      nextDungeonState: state,
      eventDrafts: [],
      createdObjects: [],
      randomDraws: [],
      unresolved: [{ sourceId: 'dungeon-topology', detail: `Illegal dungeon move ${action.fromCellId} -> ${action.toCellId} on floor ${state.activeFloor}.` }],
    };
  }
  const isBossCell = isDungeonBossCell(action.toCellId);
  const eligible = action.kind === 'enter-cell' && !isBossCell && !action.otherLivingResidentPresent;
  const draw = drawDungeonEvent({
    floor: floorName(state.activeFloor),
    nodeId: action.toCellId,
    events: input.events,
    random: input.random,
    eligibleEmptyNonBossNode: eligible,
  });
  if (draw.unresolved !== null) {
    return { nextDungeonState: state, eventDrafts: [], createdObjects: [], randomDraws: [], unresolved: [draw.unresolved] };
  }

  const selected = input.forceEventNameForTest === undefined
    ? draw.event
    : input.events.find((event) => event.floor === floorName(state.activeFloor) && event.event === input.forceEventNameForTest) ?? draw.event;
  const nextDungeonState: DungeonRuntimeState = {
    ...state,
    cellByActorId: { ...state.cellByActorId, [input.actorId]: action.toCellId },
    routeByActorId: {
      ...state.routeByActorId,
      [input.actorId]: action.isRetreat
        ? (state.routeByActorId?.[input.actorId] ?? []).slice(0, -1)
        : isEntry ? (state.routeByActorId?.[input.actorId] ?? [])
          : [...(state.routeByActorId?.[input.actorId] ?? []), action.fromCellId],
    },
    visitedCells: state.visitedCells.includes(`${state.activeFloor}:${action.toCellId}`)
      ? state.visitedCells
      : [...state.visitedCells, `${state.activeFloor}:${action.toCellId}`],
  };
  if (!eligible || selected === null) {
    return { nextDungeonState, eventDrafts: [], createdObjects: [], randomDraws: draw.randomDraws, unresolved: [] };
  }

  const eventDrafts: DungeonEventDraft[] = [{
    eventId: input.ids.eventId,
    worldTimeT: input.worldTimeT,
    actorId: input.actorId,
    nodeId: action.toCellId,
    kind: 'dungeon-cell-event',
    visibility: 'public',
    payload: { tripId: state.tripId, floor: state.activeFloor, event: selected.event ?? null, eventClass: selected.event_class ?? null },
    randomDraws: draw.randomDraws,
  }];

  const createdObjects: WorldObject[] = selected.event_class === 'container'
    ? [{
      id: `${input.ids.eventId}:container`, itemId: selected.event ?? null, objectType: 'container', remainsActorId: null,
      corpseId: null, ownerActorId: null, nodeId: action.toCellId, generatedAtT: input.worldTimeT,
      expiresAtT: input.worldTimeT + 72, unique: false, provisional: false,
      containerSourceId: dungeonContainerSourceId(floorName(state.activeFloor), selected.event ?? ''),
      dungeonLocation: { tripId: state.tripId, floor: state.activeFloor, cellId: action.toCellId },
    }]
    : [];

  const monsters = selected.event_class === 'monster'
    ? [selected.event ?? '']
    : requiresSlimeWaterwayEncounter(selected.event ?? '')
      ? ['黏液怪']
      : [];
  if (monsters.length === 0) {
    return { nextDungeonState, eventDrafts, createdObjects, randomDraws: draw.randomDraws, unresolved: [] };
  }

  const cellKey = `${state.activeFloor}:${action.toCellId}`;
  const encounter: DungeonEncounterState = { encounterId: input.ids.encounterId, monsterIds: monsters };
  const withEncounter: DungeonRuntimeState = {
    ...nextDungeonState,
    activeEncounterByCell: { ...state.activeEncounterByCell, [cellKey]: encounter },
  };
  eventDrafts.push({
    eventId: `${input.ids.eventId}:encounter`,
    worldTimeT: input.worldTimeT,
    actorId: input.actorId,
    nodeId: action.toCellId,
    kind: 'dungeon-encounter-started',
    visibility: 'public',
    payload: { encounterId: input.ids.encounterId, monsterIds: monsters },
    randomDraws: [],
  });
  return { nextDungeonState: withEncounter, eventDrafts, createdObjects, randomDraws: draw.randomDraws, unresolved: [] };
}

function floorName(floor: number): string {
  return ['雨林', '溫泉下水道', '火山洞窟'][floor - 1] ?? `unknown-floor-${floor}`;
}
