import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCsv } from '../content/csv.ts';
import { SeededRandom } from './random.ts';
import { resolveDungeonRuntimeStep, type DungeonRuntimeState } from './dungeon-runtime.ts';

const tableUrl = new URL('../../references/tables/dungeon_events.csv', import.meta.url);
const events = parseCsv(await readFile(tableUrl, 'utf8'));

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
    state: state({ cellByActorId: { residentA: 'A2' } }),
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

test('occupied cells and Boss cells never consume the ordinary event pool', () => {
  for (const action of [
    { kind: 'enter-cell' as const, fromCellId: 'A1', toCellId: 'A2', isBossCell: false, otherLivingResidentPresent: true },
    { kind: 'enter-cell' as const, fromCellId: 'A1', toCellId: 'A2', isBossCell: true, otherLivingResidentPresent: false },
  ]) {
    const random = new SeededRandom('12345678');
    const result = resolveDungeonRuntimeStep({
      state: state({ cellByActorId: { residentA: 'A2' } }), actorId: 'residentA', worldTimeT: 10,
      action, events, random, ids: { eventId: 'event-1', encounterId: 'enc-1' },
    });
    assert.equal(result.randomDraws.length, 0);
    assert.equal(random.stateHex, '12345678');
    assert.equal(result.eventDrafts.length, 0);
  }
});

test('floor three cells outside A1/B1/C1 stay gated and preserve prior state', () => {
  const before = state({ activeFloor: 3, cellByActorId: { residentA: 'A2' }, unlockedFloorByActorId: { residentA: 3 } });
  const random = new SeededRandom('12345678');
  const result = resolveDungeonRuntimeStep({
    state: before, actorId: 'residentA', worldTimeT: 20,
    action: { kind: 'enter-cell', fromCellId: 'A1', toCellId: 'A2', isBossCell: false, otherLivingResidentPresent: false },
    events, random, ids: { eventId: 'event-1', encounterId: 'enc-1' },
  });
  assert.equal(result.unresolved[0]?.sourceId, 'D-007');
  assert.equal(result.randomDraws.length, 0);
  assert.deepEqual(result.nextDungeonState, before);
});

test('wet waterway creates an additional slime encounter after its guaranteed main event', () => {
  const random = new SeededRandom('00000001');
  const result = resolveDungeonRuntimeStep({
    state: state({ activeFloor: 2, cellByActorId: { residentA: 'B1' }, unlockedFloorByActorId: { residentA: 2 } }),
    actorId: 'residentA', worldTimeT: 10,
    action: { kind: 'enter-cell', fromCellId: 'A1', toCellId: 'B1', isBossCell: false, otherLivingResidentPresent: false },
    events, random, ids: { eventId: 'event-1', encounterId: 'enc-1' },
    forceEventNameForTest: '濕滑水道',
  });
  assert.equal(result.eventDrafts.filter((event) => event.kind === 'dungeon-cell-event').length, 1);
  assert.ok(result.eventDrafts.some((event) => event.kind === 'dungeon-encounter-started'));
  assert.equal(result.nextDungeonState.activeEncounterByCell['2:B1']?.monsterIds[0], '黏液怪');
});
