import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCsv } from '../content/csv.ts';
import { SeededRandom } from './random.ts';
import { DUNGEON_CELL_IDS, DUNGEON_ENTRY_CELL_ID, DUNGEON_BOSS_CELL_ID, dungeonCellNeighbors, dungeonContainerSourceId, isDungeonBossCell, resolveDungeonRuntimeStep, type DungeonRuntimeState } from './dungeon-runtime.ts';

const tableUrl = new URL('../../references/tables/dungeon_events.csv', import.meta.url);
const events = parseCsv(await readFile(tableUrl, 'utf8'));

test('all three floors share the mapped three-branch topology with a three-step route to the Boss', () => {
  assert.deepEqual(DUNGEON_CELL_IDS, ['S', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'E']);
  assert.equal(DUNGEON_ENTRY_CELL_ID, 'S');
  assert.equal(isDungeonBossCell('E'), true);
  assert.equal(isDungeonBossCell('A2'), false);

  for (const floor of [1, 2, 3]) {
    for (const [first, second] of [['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']] as const) {
      assert.ok(dungeonCellNeighbors(floor, 'S').includes(first));
      assert.ok(dungeonCellNeighbors(floor, first).includes('S'));
      assert.ok(dungeonCellNeighbors(floor, first).includes(second));
      assert.ok(dungeonCellNeighbors(floor, second).includes(first));
      assert.ok(dungeonCellNeighbors(floor, second).includes('E'));
      assert.ok(dungeonCellNeighbors(floor, 'E').includes(second));
      assert.equal(shortestPathLength(floor, 'S', 'E'), 3);
    }
    assert.deepEqual(dungeonCellNeighbors(floor, 'A1'), ['S', 'A2']);
  }
});

test('maps only the explicit dungeon container sources and preserves event display names', () => {
  assert.equal(dungeonContainerSourceId('雨林', '遺失背包'), '第一層遺失背包');
  assert.equal(dungeonContainerSourceId('雨林', '森林寶箱'), '第一層林中寶箱');
  assert.equal(dungeonContainerSourceId('溫泉下水道', '漂流背包'), '第二層漂流背包');
  assert.equal(dungeonContainerSourceId('溫泉下水道', '生鏽寶箱'), '第二層生鏽寶箱');
  assert.equal(dungeonContainerSourceId('火山洞窟', '遠古寶箱'), '第三層古老寶箱');
  assert.equal(dungeonContainerSourceId('火山洞窟', '探險者遺物'), null);
  assert.equal(dungeonContainerSourceId('雨林', '未知箱子'), null);
});

function shortestPathLength(floor: number, start: string, target: string): number {
  const queue: { cell: string; distance: number }[] = [{ cell: start, distance: 0 }];
  const visited = new Set([start]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (current.cell === target) return current.distance;
    for (const neighbor of dungeonCellNeighbors(floor, current.cell)) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push({ cell: neighbor, distance: current.distance + 1 });
    }
  }
  return -1;
}

function state(overrides: Partial<DungeonRuntimeState> = {}): DungeonRuntimeState {
  return {
    schemaVersion: 1,
    tripId: 'trip-1',
    activeFloor: 1,
    cellByActorId: { residentA: 'A1' },
    unlockedFloorByActorId: { residentA: 1 },
    visitedCells: [],
    activeEncounterByCell: {},
    ...overrides,
  };
}

test('an empty non-Boss cell entry draws exactly one source-weighted floor event', () => {
  const random = new SeededRandom('12345678');
  const result = resolveDungeonRuntimeStep({
    state: state({ cellByActorId: { residentA: 'A1' } }),
    actorId: 'residentA',
    worldTimeT: 10,
    action: { kind: 'enter-cell', fromCellId: 'A1', toCellId: 'A2', isBossCell: false, otherLivingResidentPresent: false },
    events,
    random,
    ids: { eventId: 'event-1', encounterId: 'enc-1' },
  });
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.nextDungeonState.cellByActorId.residentA, 'A2');
  assert.equal(result.nextDungeonState.visitedCells.includes('1:A2'), true);
  assert.equal(result.randomDraws.length, 1);
  assert.ok(result.eventDrafts.some((event) => event.kind === 'dungeon-cell-event'));
});

test('materializes unopened dungeon containers as expiring world objects', () => {
  const result = resolveDungeonRuntimeStep({
    state: state({ cellByActorId: { residentA: 'A1' } }), actorId: 'residentA', worldTimeT: 10,
    action: { kind: 'enter-cell', fromCellId: 'A1', toCellId: 'A2', isBossCell: false, otherLivingResidentPresent: false },
    events, random: new SeededRandom('12345678'), ids: { eventId: 'event-container', encounterId: 'enc-container' },
    forceEventNameForTest: '遺失背包',
  });
  assert.equal(result.createdObjects.length, 1);
  assert.deepEqual(result.createdObjects[0], {
    id: 'event-container:container', itemId: '遺失背包', objectType: 'container', remainsActorId: null,
    corpseId: null, ownerActorId: null, nodeId: 'A2', generatedAtT: 10, expiresAtT: 82, unique: false, provisional: false,
    containerSourceId: '第一層遺失背包', dungeonLocation: { tripId: 'trip-1', floor: 1, cellId: 'A2' },
  });
});

test('occupied cells and Boss cells never consume the ordinary event pool', () => {
  for (const action of [
    { kind: 'enter-cell' as const, fromCellId: 'A1', toCellId: 'A2', isBossCell: false, otherLivingResidentPresent: true },
    { kind: 'enter-cell' as const, fromCellId: 'A2', toCellId: 'E', isBossCell: false, otherLivingResidentPresent: false },
  ]) {
    const random = new SeededRandom('12345678');
    const result = resolveDungeonRuntimeStep({
      state: state({ cellByActorId: { residentA: action.toCellId === 'E' ? 'A2' : 'A1' } }), actorId: 'residentA', worldTimeT: 10,
      action, events, random, ids: { eventId: 'event-1', encounterId: 'enc-1' },
    });
    assert.equal(result.randomDraws.length, 0);
    assert.equal(random.stateHex, '12345678');
    assert.equal(result.eventDrafts.length, 0);
  }
});

test('floor three non-first-row cells use the redistributed pool and advance without a gate', () => {
  const before = state({ activeFloor: 3, cellByActorId: { residentA: 'A1' }, unlockedFloorByActorId: { residentA: 3 } });
  const random = new SeededRandom('12345678');
  const result = resolveDungeonRuntimeStep({
    state: before, actorId: 'residentA', worldTimeT: 20,
    action: { kind: 'enter-cell', fromCellId: 'A1', toCellId: 'A2', isBossCell: false, otherLivingResidentPresent: false },
    events, random, ids: { eventId: 'event-1', encounterId: 'enc-1' },
  });
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.randomDraws.length, 1);
  assert.equal(result.nextDungeonState.cellByActorId.residentA, 'A2');
  assert.ok(result.eventDrafts.some((event) => event.kind === 'dungeon-cell-event'));
});

test('rejects non-adjacent movement without consuming RNG or changing the actor cell', () => {
  const before = state({ cellByActorId: { residentA: 'A1' } });
  const random = new SeededRandom('12345678');
  const result = resolveDungeonRuntimeStep({
    state: before, actorId: 'residentA', worldTimeT: 10,
    action: { kind: 'enter-cell', fromCellId: 'A1', toCellId: 'B1', isBossCell: false, otherLivingResidentPresent: false },
    events, random, ids: { eventId: 'event-1', encounterId: 'enc-1' },
  });
  assert.equal(result.unresolved[0]?.sourceId, 'dungeon-topology');
  assert.deepEqual(result.nextDungeonState, before);
  assert.equal(result.randomDraws.length, 0);
  assert.equal(random.stateHex, '12345678');
});

test('wet waterway creates an additional slime encounter after its guaranteed main event', () => {
  const random = new SeededRandom('00000001');
  const result = resolveDungeonRuntimeStep({
    state: state({ activeFloor: 2, cellByActorId: { residentA: 'S' }, unlockedFloorByActorId: { residentA: 2 } }),
    actorId: 'residentA', worldTimeT: 10,
    action: { kind: 'enter-cell', fromCellId: 'S', toCellId: 'B1', isBossCell: false, otherLivingResidentPresent: false },
    events, random, ids: { eventId: 'event-1', encounterId: 'enc-1' },
    forceEventNameForTest: '濕滑水道',
  });
  assert.equal(result.eventDrafts.filter((event) => event.kind === 'dungeon-cell-event').length, 1);
  assert.ok(result.eventDrafts.some((event) => event.kind === 'dungeon-encounter-started'));
  assert.equal(result.nextDungeonState.activeEncounterByCell['2:B1']?.monsterIds[0], '黏液怪');
});
