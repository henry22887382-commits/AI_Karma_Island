import assert from 'node:assert/strict';
import test from 'node:test';
import { dayPhaseAt, nextActionTime, orderReadyActors } from './clock.ts';

test('uses 72 integer T per day, with 48 day T and 24 night T', () => {
  assert.equal(dayPhaseAt(0), 'day');
  assert.equal(dayPhaseAt(47), 'day');
  assert.equal(dayPhaseAt(48), 'night');
  assert.equal(dayPhaseAt(71), 'night');
  assert.equal(dayPhaseAt(72), 'day');
});

test('an action advances only its own actor readiness by the supplied cost', () => {
  assert.equal(nextActionTime(10, 1), 11);
  assert.equal(nextActionTime(10, 3), 13);
});

test('higher speed orders actors ready at the same time without changing readiness', () => {
  const ordered = orderReadyActors([
    { id: 'slow', speed: 1, nextActionAtT: 14, alive: true },
    { id: 'fast', speed: 3, nextActionAtT: 14, alive: true },
  ], 14);

  assert.deepEqual(ordered.actors.map((actor) => actor.id), ['fast', 'slow']);
  assert.deepEqual(ordered.actors.map((actor) => actor.nextActionAtT), [14, 14]);
});

test('excludes dead actors and reports same-speed ordering as unresolved unless a policy is supplied', () => {
  const result = orderReadyActors([
    { id: 'resident-a', speed: 2, nextActionAtT: 14, alive: true },
    { id: 'resident-b', speed: 2, nextActionAtT: 14, alive: true },
    { id: 'dead', speed: 9, nextActionAtT: 14, alive: false },
  ], 14);

  assert.equal(result.actors.length, 0);
  assert.deepEqual(result.unresolved, ['C-15: same-time actors with equal speed need an approved tie-break policy']);
});
