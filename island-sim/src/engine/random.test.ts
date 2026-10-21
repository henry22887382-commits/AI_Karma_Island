import assert from 'node:assert/strict';
import test from 'node:test';
import { SeededRandom, seedToState } from './random.ts';

test('same seed and state reproduce draws and preserve before/after replay information', () => {
  const state = seedToState('run-001');
  const left = new SeededRandom(state);
  const right = new SeededRandom(state);
  const leftDraws = [left.next('fish-pool'), left.next('attack')];
  const rightDraws = [right.next('fish-pool'), right.next('attack')];
  assert.deepEqual(leftDraws, rightDraws);
  assert.notEqual(left.stateHex, state);
  assert.equal(leftDraws[0]?.stateBefore, state);
  assert.equal(leftDraws[0]?.stateAfter, leftDraws[1]?.stateBefore);
});
