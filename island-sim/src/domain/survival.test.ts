import assert from 'node:assert/strict';
import test from 'node:test';
import { addInventoryItem, applyFood, createInitialVitals, foodSpoilAtT, isExpiredAt, objectExpiresAtT, type InventoryItem } from './survival.ts';

test('initial resident survival resources match the reference', () => {
  assert.deepEqual(createInitialVitals(), { hitPoints: 30, hunger: 5, sleep: 3, inventory: [] });
});

test('food is usable only below hunger 5, consumed whole, and may raise hunger above 5', () => {
  const start = { ...createInitialVitals(), hunger: 4 };
  assert.deepEqual(applyFood(start, { itemId: 'fish', hungerChange: 3, hitPointChange: 0, sleepChange: 0, edible: true }), {
    accepted: true,
    vitals: { ...start, hunger: 7 },
    unresolved: [],
  });
  assert.equal(applyFood(createInitialVitals(), { itemId: 'fish', hungerChange: 3, hitPointChange: 0, sleepChange: 0, edible: true }).accepted, false);
});

test('uses ten distinct inventory slots without stacking same item ids', () => {
  const nineItems = Array.from({ length: 9 }, (_, index) => ({ objectId: `o-${index}`, itemId: 'fish' }));
  const full = nineItems.reduce<readonly InventoryItem[]>((inventory, item) => addInventoryItem(inventory, item).inventory, []);
  assert.equal(full.length, 9);
  assert.equal(addInventoryItem(full, { objectId: 'o-9', itemId: 'fish' }).inventory.length, 10);
  assert.equal(addInventoryItem([...full, { objectId: 'o-9', itemId: 'fish' }], { objectId: 'o-10', itemId: 'fish' }).accepted, false);
});

test('keeps three-island-day spoil start unresolved and does not expire coconut by generic spoil rule', () => {
  assert.deepEqual(foodSpoilAtT(40, 'ordinary'), { expiresAtT: null, unresolved: 'C-11: three-island-day spoil start event remains unverified' });
  assert.deepEqual(foodSpoilAtT(40, 'coconut'), { expiresAtT: null, unresolved: null });
});

test('expires ordinary ground objects at generation plus 72T while retaining special objects', () => {
  assert.equal(objectExpiresAtT(10, 'ordinary'), 82);
  assert.equal(isExpiredAt(82, 81), false);
  assert.equal(isExpiredAt(82, 82), true);
  for (const kind of ['natural-coconut', 'corpse', 'inscription', 'hero-unique'] as const) {
    assert.equal(objectExpiresAtT(10, kind), null);
  }
});
