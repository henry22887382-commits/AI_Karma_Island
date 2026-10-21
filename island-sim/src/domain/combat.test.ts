import assert from 'node:assert/strict';
import test from 'node:test';
import { monsterDamageToResident, playerDamageOnHit, residentSpeed } from './combat.ts';

test('applies distinct player and monster damage floors', () => {
  assert.equal(playerDamageOnHit(3, 4), 1);
  assert.equal(monsterDamageToResident(7, 8), 0);
});

test('uses half-up rounding for HP/10 plus equipment speed modifiers', () => {
  assert.deepEqual(residentSpeed(30, 1), { speed: 4, unresolved: null });
  assert.deepEqual(residentSpeed(5, 0), { speed: 1, unresolved: null });
  assert.deepEqual(residentSpeed(15, 0), { speed: 2, unresolved: null });
  assert.deepEqual(residentSpeed(25, 0), { speed: 3, unresolved: null });
  assert.deepEqual(residentSpeed(15, 1), { speed: 3, unresolved: null });
});
