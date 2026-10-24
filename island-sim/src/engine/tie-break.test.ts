import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSameSpeed, orderReadyActorsByPriority, resolveSameSpeedGroup, type TieBreakMetrics } from './tie-break.ts';

const stats = (id: string, overrides: Partial<TieBreakMetrics> = {}): TieBreakMetrics => ({
  id,
  hitPoints: 30,
  hunger: 5,
  sleep: 3,
  attack: 3,
  defense: 0,
  emptySlots: 10,
  ...overrides,
});

test('compares same-speed actors lexicographically by higher HP, then hunger', () => {
  assert.equal(compareSameSpeed(stats('hp', { hitPoints: 20 }), stats('food', { hunger: 0 })).winnerId, 'food');
  assert.equal(compareSameSpeed(stats('food', { hunger: 4 }), stats('food-high', { hunger: 5 })).winnerId, 'food-high');
});

test('compares higher sleep resource before attack, defense and empty inventory slots', () => {
  assert.equal(compareSameSpeed(stats('rested', { sleep: 3 }), stats('tired', { sleep: 0 })).winnerId, 'rested');
  assert.equal(compareSameSpeed(stats('attacker', { attack: 8 }), stats('defender', { defense: 8 })).winnerId, 'attacker');
  assert.equal(compareSameSpeed(stats('defender', { defense: 2 }), stats('empty', { emptySlots: 10 })).winnerId, 'defender');
  assert.equal(compareSameSpeed(stats('space', { emptySlots: 10 }), stats('full', { emptySlots: 0 })).winnerId, 'space');
});

test('skips metrics that are absent for one or both actors and compares the remaining shared metrics', () => {
  assert.equal(compareSameSpeed(
    stats('monster', { hunger: null, sleep: null, attack: null, emptySlots: null, hitPoints: 12 }),
    stats('monster-higher-hp', { hunger: null, sleep: null, attack: null, emptySlots: null, hitPoints: 13 }),
  ).winnerId, 'monster-higher-hp');
  assert.equal(compareSameSpeed(
    stats('no-metrics-a', { hitPoints: null, hunger: null, sleep: null, attack: null, defense: null, emptySlots: null }),
    stats('no-metrics-b', { hitPoints: null, hunger: null, sleep: null, attack: null, defense: null, emptySlots: null }),
  ).tied, true);
});

test('uses seeded Fisher-Yates draws and captures replay material for a fully tied group', () => {
  const actors = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const metrics = new Map(actors.map(({ id }) => [id, stats(id)]));
  const first = resolveSameSpeedGroup(actors, metrics, '0000002a');
  const replay = resolveSameSpeedGroup(actors, metrics, '0000002a');
  assert.deepEqual(first.actors.map((actor) => actor.id), replay.actors.map((actor) => actor.id));
  assert.deepEqual(first.draws, replay.draws);
  assert.equal(first.draws.length, 3);
  assert.equal(first.rngState, replay.rngState);
});

test('integrates lexicographic priority into same-time scheduling and records only final random ties', () => {
  const actors = [
    { id: 'tie-b', speed: 4, nextActionAtT: 8, alive: true },
    { id: 'lower-speed', speed: 3, nextActionAtT: 8, alive: true },
    { id: 'hp-leader', speed: 4, nextActionAtT: 8, alive: true },
    { id: 'tie-a', speed: 4, nextActionAtT: 8, alive: true },
  ];
  const metrics = new Map([
    ['tie-b', stats('tie-b', { hitPoints: 20 })],
    ['lower-speed', stats('lower-speed', { hitPoints: 30 })],
    ['hp-leader', stats('hp-leader', { hitPoints: 30 })],
    ['tie-a', stats('tie-a', { hitPoints: 20 })],
  ]);
  const result = orderReadyActorsByPriority(actors, 8, metrics, '0000002a');
  assert.deepEqual(result.actors.map(({ id }) => id), ['hp-leader', 'tie-a', 'tie-b', 'lower-speed']);
  assert.equal(result.draws.length, 1);
  assert.equal(result.draws[0]?.sourceId, 'same-speed-priority-final-draw');
  assert.deepEqual(result.unresolved, []);
});

test('fails closed when a same-speed metric is missing', () => {
  const actors = [
    { id: 'a', speed: 4, nextActionAtT: 8, alive: true },
    { id: 'b', speed: 4, nextActionAtT: 8, alive: true },
  ];
  const result = orderReadyActorsByPriority(actors, 8, new Map(), '0000002a');
  assert.deepEqual(result.actors, []);
  assert.match(result.unresolved[0] ?? '', /metrics missing/);
});
